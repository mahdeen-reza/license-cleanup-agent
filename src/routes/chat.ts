/**
 * chat.ts
 *
 * POST /api/analysis/:runId/chat
 *   Review conversation. Interprets analyst instructions against a completed
 *   run: reclassify a user, add an exception, ask why, or filter/query results.
 *
 * GET  /api/criteria/:systemId
 *   Returns the current AccessCriteria document for a system.
 *
 * POST /api/criteria/:systemId/chat
 *   Criteria update conversation. Drafts criteria changes; on confirmation
 *   saves a new CriteriaVersion and updates the AccessCriteria record.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { invokeModel } from '../lib/ai';
import { SEED_FOUNDATIONAL_KNOWLEDGE } from '../intelligence/foundationalKnowledge';
import { createSporadicFlag } from '../core/sporadicFlagService';
import type { Classification } from '../core/classifier';

const router = Router();
const MAX_MESSAGE_LENGTH = 10_000;

// ─── Shared: persist a chat message ──────────────────────────────────────────

async function saveChatMessage(
  contextType: string,
  contextId: string,
  role: 'user' | 'assistant',
  content: string,
  userEmail?: string,
) {
  await prisma.chatMessage.create({
    data: { contextType, contextId, role, content, userEmail },
  });
}

// ─── POST /api/analysis/:runId/chat ──────────────────────────────────────────

const VALID_CLASSIFICATIONS = new Set<Classification>([
  'Direct Remove', 'Notify First', 'Ex-Employee', 'GTM — Consult Required',
  'Cross-Instance Anomaly', 'Prior Exception', 'Human Review', 'Excluded', 'Unresolved',
]);

router.post('/analysis/:runId/chat', async (req: Request, res: Response) => {
  const { runId } = req.params;
  const { message } = req.body as { message?: string };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message must be under ${MAX_MESSAGE_LENGTH} characters.` });
  }

  // Load the run + results for context
  const run = await prisma.analysisRun.findUnique({
    where: { id: runId },
    include: { results: true },
  });

  if (!run) {
    return res.status(404).json({ error: `Run ${runId} not found.` });
  }

  // Load conversation history for this run
  const history = await prisma.chatMessage.findMany({
    where: { contextType: 'analysis_run', contextId: runId },
    orderBy: { createdAt: 'asc' },
  });

  // Persist the incoming user message
  await saveChatMessage('analysis_run', runId, 'user', message.trim(), req.userEmail);

  // Build the prompt for the AI model
  const systemPrompt = buildReviewChatSystemPrompt(run, history);
  const fullPrompt = `${systemPrompt}\n\n## Analyst message\n${message.trim()}`;

  const rawResponse = await invokeModel(fullPrompt);

  // Parse the AI model's structured response
  const action = parseReviewChatAction(rawResponse);

  // Execute the action
  let agentReply = rawResponse;

  if (action?.type === 'reclassify' && action.email && action.newClassification) {
    // Validate the new classification
    if (!VALID_CLASSIFICATIONS.has(action.newClassification as Classification)) {
      agentReply = `I couldn't reclassify — "${action.newClassification}" is not a valid classification.`;
    } else {
      // Update the result record
      await prisma.analysisResult.updateMany({
        where: { runId, email: { equals: action.email, mode: 'insensitive' } },
        data: { classification: action.newClassification },
      });

      // Log the override
      await prisma.chatOverride.create({
        data: {
          runId,
          userEmail: req.userEmail,
          targetUserEmail: action.email,
          originalClassification: action.originalClassification ?? 'unknown',
          newClassification: action.newClassification,
          reason: action.reason ?? message.trim(),
        },
      });

      agentReply = action.reply ?? `Done — ${action.email} has been moved to ${action.newClassification}.`;
    }
  } else if (action?.type === 'add_exception' && action.email) {
    // Add to prior exception register for this system
    await prisma.priorException.upsert({
      where: {
        // PriorException has no compound unique key — use a findFirst + create
        // pattern via the upsert's where clause matching a dummy non-existent id
        id: 'nonexistent-placeholder',
      },
      update: {},
      create: {
        systemId: run.systemId,
        userEmail: action.email,
        userName: action.userName ?? action.email,
        role: action.role ?? '',
        justification: action.justification ?? message.trim(),
        action: 'keep_flag',
      },
    }).catch(async () => {
      // upsert doesn't work well without unique — fall back to create
      await prisma.priorException.create({
        data: {
          systemId: run.systemId,
          userEmail: action.email!,
          userName: action.userName ?? action.email!,
          role: action.role ?? '',
          justification: action.justification ?? message.trim(),
          action: 'keep_flag',
        },
      });
    });

    agentReply = action.reply ?? `Done — ${action.email} has been added to the exception register for this instance. They will be surfaced as Prior Exception in future runs.`;
  } else if (action?.type === 'flag_sporadic' && action.email) {
    // Look up the user's name from the run results
    const targetResult = run.results.find(
      (r) => r.email.toLowerCase() === action.email!.toLowerCase(),
    );
    const userName = targetResult?.fullName ?? action.userName ?? action.email;

    await createSporadicFlag({
      systemId: run.systemId,
      instanceName: run.instanceName,
      userEmail: action.email,
      userName,
      note: action.sporadicNote ?? message.trim(),
      flaggedBy: req.userEmail,
    });

    agentReply = action.reply ?? `Flagged ${action.email} as temporary/project-based access on ${run.instanceName}: "${action.sporadicNote ?? message.trim()}". This flag will provide context in future runs but will not prevent removal.`;
  }
  // For 'explain', 'query', and 'unknown' action types, agentReply = rawResponse (AI model's text)

  // Persist the assistant reply
  await saveChatMessage('analysis_run', runId, 'assistant', agentReply, undefined);

  return res.json({ reply: agentReply, action: action?.type ?? 'explain' });
});

// ─── GET /api/criteria/:systemId ─────────────────────────────────────────────

router.get('/criteria/:systemId', async (req: Request, res: Response) => {
  const { systemId } = req.params;

  const criteria = await prisma.accessCriteria.findUnique({
    where: { instanceId: systemId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 10, // last 10 versions
      },
    },
  });

  if (!criteria) {
    // Return the seed knowledge as the default — no criteria configured yet
    return res.json({
      instanceId: systemId,
      instanceName: systemId,
      content: SEED_FOUNDATIONAL_KNOWLEDGE,
      version: 0,
      isDefault: true,
      versions: [],
    });
  }

  return res.json(criteria);
});

// ─── POST /api/criteria/:systemId/chat ───────────────────────────────────────

router.post('/criteria/:systemId/chat', async (req: Request, res: Response) => {
  const systemId = req.params.systemId;
  const { message, confirm } = req.body as { message?: string; confirm?: boolean };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message must be under ${MAX_MESSAGE_LENGTH} characters.` });
  }

  // Load current criteria (or use seed as base)
  const existing = await prisma.accessCriteria.findUnique({
    where: { instanceId: systemId },
  });

  const currentContent = existing?.content
    ? JSON.stringify(existing.content, null, 2)
    : SEED_FOUNDATIONAL_KNOWLEDGE;

  const currentVersion = existing?.version ?? 0;

  // Load conversation history for this criteria
  const history = await prisma.chatMessage.findMany({
    where: { contextType: 'criteria', contextId: systemId },
    orderBy: { createdAt: 'asc' },
  });

  await saveChatMessage('criteria', systemId, 'user', message.trim(), req.userEmail);

  if (confirm && existing) {
    // The analyst has confirmed a pending draft — look for it in recent history
    const lastAssistantMessage = [...history].reverse().find((m) => m.role === 'assistant');
    const draftContent = lastAssistantMessage?.content ?? currentContent;

    const newVersion = currentVersion + 1;

    // Save version snapshot
    await prisma.criteriaVersion.create({
      data: {
        criteriaId: existing.id,
        content: existing.content ?? {},
        version: currentVersion,
        changedBy: req.userEmail,
        changeNote: message.trim(),
      },
    });

    // Update the criteria record
    await prisma.accessCriteria.update({
      where: { instanceId: systemId },
      data: {
        content: draftContent,
        version: newVersion,
        updatedBy: req.userEmail,
      },
    });

    const reply = `Criteria updated to version ${newVersion}. The new rules will apply to all future analysis runs for this system.`;
    await saveChatMessage('criteria', systemId, 'assistant', reply, undefined);
    return res.json({ reply, version: newVersion, confirmed: true });
  }

  // Draft mode — ask the AI model to propose the update
  const prompt = buildCriteriaChatPrompt(systemId, currentContent, history, message.trim());
  const draft = await invokeModel(prompt);

  await saveChatMessage('criteria', systemId, 'assistant', draft, undefined);

  return res.json({ reply: draft, confirmed: false });
});

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildReviewChatSystemPrompt(
  run: { instanceName: string; mode: string; results: { email: string; fullName: string; classification: string; reasoning: string }[] },
  history: { role: string; content: string }[],
): string {
  const resultsSummary = run.results
    .map((r) => `- ${r.email} (${r.fullName}): ${r.classification} — ${r.reasoning}`)
    .join('\n');

  const conversationHistory = history.length > 0
    ? history.map((m) => `${m.role === 'user' ? 'Analyst' : 'Agent'}: ${m.content}`).join('\n')
    : 'No prior conversation.';

  return `
You are a Salesforce license clean-up assistant reviewing analysis results with an analyst.

## Current Run Context
Instance: ${run.instanceName}
Mode: ${run.mode}

## Analysis Results (${run.results.length} users)
${resultsSummary}

## Conversation History
${conversationHistory}

## Your Task
Interpret the analyst's message. It will be one of:
1. Reclassify a user — respond with JSON: {"type":"reclassify","email":"...","originalClassification":"...","newClassification":"...","reason":"...","reply":"..."}
2. Add an exception — respond with JSON: {"type":"add_exception","email":"...","userName":"...","role":"...","justification":"...","reply":"..."}
3. Flag a user as temporary/project-based access — respond with JSON: {"type":"flag_sporadic","email":"...","userName":"...","sporadicNote":"...","reply":"..."}
   This is for users with known temporary/project-based access patterns (quarter-end, seasonal, project-based).
   The flag does NOT protect them from removal — it records the pattern for context in future runs.
4. Explain a classification — respond with plain English explaining the reasoning
5. Filter/query results — respond with a plain English answer citing the relevant users

For reclassify, add_exception, and flag_sporadic, respond ONLY with the JSON object.
For explain and query, respond in plain English.
`.trim();
}

function buildCriteriaChatPrompt(
  systemId: string,
  currentContent: string,
  history: { role: string; content: string }[],
  message: string,
): string {
  const conversationHistory = history.length > 0
    ? history.map((m) => `${m.role === 'user' ? 'Analyst' : 'Agent'}: ${m.content}`).join('\n')
    : 'No prior conversation.';

  return `
You are a Salesforce license clean-up assistant helping update access criteria.

## Current Access Criteria for ${systemId}
${currentContent}

## Conversation History
${conversationHistory}

## Analyst Request
${message}

## Your Task
Draft an updated access criteria document that incorporates the analyst's change.
Explain what you changed and why. Flag any users from recent runs who would be
affected by this rule change if you can infer that from the current criteria.

End your response with:
"Reply 'confirm' to save this update, or describe any further changes you'd like."
`.trim();
}

// ─── Action parser ────────────────────────────────────────────────────────────

interface ReviewChatAction {
  type: 'reclassify' | 'add_exception' | 'flag_sporadic' | 'explain' | 'query' | 'unknown';
  email?: string;
  originalClassification?: string;
  newClassification?: string;
  reason?: string;
  userName?: string;
  role?: string;
  justification?: string;
  sporadicNote?: string;
  reply?: string;
}

function parseReviewChatAction(raw: string): ReviewChatAction | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(trimmed) as ReviewChatAction;
    if (parsed.type === 'reclassify' || parsed.type === 'add_exception' || parsed.type === 'flag_sporadic') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export default router;
