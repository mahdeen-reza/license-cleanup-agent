/**
 * onboarding.ts
 *
 * POST /api/systems/onboard
 *   Accepts multipart form upload with system metadata + CSV files.
 *   Parses the CSVs, calls the AI model to generate a Reasoning Table JSON,
 *   and returns it for human review. Falls back to a mock template
 *   when the AI provider is not configured or unavailable.
 *
 * POST /api/systems/onboard/confirm
 *   Accepts the reviewed Reasoning Table + system metadata.
 *   Creates the System and ReasoningTable records in the DB.
 *
 * POST /api/systems/:systemId/generate-docs
 *   Generates a formal stakeholder-ready Markdown document for a system.
 *   Falls back to a data-filled template when the AI provider is unavailable.
 */

import { Router, type Request, type Response } from 'express';
import type { Multer } from 'multer';
import { parse } from 'csv-parse/sync';
import { prisma } from '../lib/prisma';
import { invokeModel } from '../lib/ai';
import { SEED_FOUNDATIONAL_KNOWLEDGE } from '../intelligence/foundationalKnowledge';

// ─── Reasoning Table content schema ──────────────────────────────────────────

export interface ReasoningTableContent {
  systemName: string;
  toolPurpose: string;
  primaryUserBase: string;
  inactivitySignals: Array<{
    fieldName: string;
    weight: number;
    reasoning: string;
  }>;
  thresholds: {
    standardDays: number;
    urgentDays: number;
  };
  consultRequiredRoles: string[];
  integrationPatterns: string[];
  gtmEquivalentRoles: string;
  additionalNotes: string;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function extractCsvSample(buffer: Buffer): { headers: string[]; sample: Record<string, string>[] } {
  const rows = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const sample = rows.slice(0, 5);
  return { headers, sample };
}

// ─── Mock fallback ────────────────────────────────────────────────────────────

function buildMockReasoningTable(name: string, usageHeaders: string[]): ReasoningTableContent {
  const activityFields = usageHeaders.filter(h =>
    /date|activity|last|login|access|visit/i.test(h),
  ).slice(0, 4);

  return {
    systemName: name,
    toolPurpose: `[Placeholder] Describe what ${name} does and its business purpose.`,
    primaryUserBase: '[Placeholder] Describe the primary user groups (e.g. Sales, CS, GTM).',
    inactivitySignals: activityFields.length > 0
      ? activityFields.map(h => ({
          fieldName: h,
          weight: 0.5,
          reasoning: `[Placeholder] Describe how "${h}" signals inactivity.`,
        }))
      : [{ fieldName: '[detected-field]', weight: 0.5, reasoning: '[Placeholder] Explain signal.' }],
    thresholds: { standardDays: 60, urgentDays: 30 },
    consultRequiredRoles: [
      '[Placeholder] e.g. Account Executive',
      '[Placeholder] e.g. VP of Sales',
    ],
    integrationPatterns: ['integration', 'api', 'bot', 'service', 'system'],
    gtmEquivalentRoles: '[Placeholder] Describe revenue-facing roles that should never be auto-actioned.',
    additionalNotes: '[Placeholder] Any special cases, known exceptions, or rules for this system.',
  };
}

// ─── AI generation ───────────────────────────────────────────────────────────

async function generateReasoningTableViaAI(
  name: string,
  description: string,
  usageHeaders: string[],
  usageSample: Record<string, string>[],
  pastHeaders: string[],
  pastSample: Record<string, string>[],
): Promise<ReasoningTableContent> {
  const prompt = `${SEED_FOUNDATIONAL_KNOWLEDGE}

---

You are generating a Reasoning Table for a new system being onboarded into the License Clean-Up Agent.
The Reasoning Table defines how the agent should classify users for license clean-up on this system.

## New System Details

**System Name:** ${name}

**Description:** ${description}

## Usage Report CSV Schema
Columns: ${usageHeaders.join(', ')}

Sample rows (up to 5):
${JSON.stringify(usageSample, null, 2)}

${pastHeaders.length > 0
  ? `## Past Manual Analysis CSV Schema
Columns: ${pastHeaders.join(', ')}

Sample rows (up to 5):
${JSON.stringify(pastSample, null, 2)}`
  : '## Past Analysis CSV: Not provided'}

---

Generate a Reasoning Table JSON object for this system.
Return ONLY valid JSON matching this exact structure — no markdown fences, no explanation:

{
  "systemName": "string",
  "toolPurpose": "string — 1-2 sentences: what the tool does, who uses it, business context",
  "primaryUserBase": "string — describe the primary user groups",
  "inactivitySignals": [
    {
      "fieldName": "string — column name from the usage CSV",
      "weight": 0.1 to 1.0,
      "reasoning": "string — why this field indicates inactivity"
    }
  ],
  "thresholds": {
    "standardDays": number,
    "urgentDays": number
  },
  "consultRequiredRoles": ["string — job titles or teams requiring human review before removal"],
  "integrationPatterns": ["string — keywords identifying service/integration/bot accounts"],
  "gtmEquivalentRoles": "string — roles equivalent to GTM (revenue-facing) that should never be auto-actioned",
  "additionalNotes": "string — any special cases, known exceptions, or rules"
}`;

  const raw = await invokeModel(prompt);
  const cleaned = raw.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return JSON.parse(cleaned) as ReasoningTableContent;
}

// ─── Documentation generation ─────────────────────────────────────────────────

function buildDocumentationTemplate(
  system: { name: string; description: string },
  rt: ReasoningTableContent | null,
  exceptions: Array<{
    userEmail: string; userName: string; role: string;
    justification: string; action: string;
  }>,
  instanceConfigs: Array<{
    instanceName: string; defaultScope: string;
    thresholds: unknown; gtmHandling: string;
  }>,
): string {
  return `# ${system.name} — License Clean-Up Documentation

## 1. System Overview

${system.description}

${rt ? `**Purpose:** ${rt.toolPurpose}

**Primary User Base:** ${rt.primaryUserBase}` : ''}

---

## 2. Access Criteria

${rt?.gtmEquivalentRoles ? `**Revenue-Facing / GTM-Equivalent Roles:** ${rt.gtmEquivalentRoles}` : '[Access criteria not yet configured]'}

${rt?.additionalNotes ? `**Additional Rules:** ${rt.additionalNotes}` : ''}

---

## 3. Inactivity Thresholds

| Mode | Threshold |
|---|---|
| Standard | ${rt?.thresholds?.standardDays ?? 60}+ days of inactivity |
| Urgent | ${rt?.thresholds?.urgentDays ?? 30}+ days of inactivity |
| Critical | All users regardless of activity |

${rt?.inactivitySignals?.length
  ? `**Activity Signals:**
| Field | Weight | Reasoning |
|---|---|---|
${rt.inactivitySignals.map(s => `| ${s.fieldName} | ${s.weight} | ${s.reasoning} |`).join('\n')}`
  : ''}

---

## 4. GTM Handling Rules

${rt?.consultRequiredRoles?.length
  ? `The following roles require manager consultation before any license action:\n\n${rt.consultRequiredRoles.map(r => `- ${r}`).join('\n')}`
  : '[No GTM-equivalent roles configured]'}

---

## 5. Instance Configurations

${instanceConfigs.length > 0
  ? instanceConfigs.map(ic => `### ${ic.instanceName}
- Default Scope: ${ic.defaultScope}
- GTM Handling: ${ic.gtmHandling}
- Thresholds: ${JSON.stringify(ic.thresholds)}`).join('\n\n')
  : '[No instances configured for this system]'}

---

## 6. Exception Register

${exceptions.length > 0
  ? `| Email | Name | Role | Justification | Action |
|---|---|---|---|---|
${exceptions.map(e => `| ${e.userEmail} | ${e.userName} | ${e.role} | ${e.justification} | ${e.action} |`).join('\n')}`
  : 'No documented exceptions for this system.'}

---

## 7. Escalation Procedures

Borderline cases are routed to the Human Review tab. These include:
- Protected department users (never directly actioned)
- Ambiguous name matches (Tier 3 resolution)
- Discrepant activity signals between fields
- Unknown GTM status

---

## 8. Audit Trail Requirements

Every analysis run records:
- Analyst email
- Run timestamp, instance, and clean-up mode
- Per-user classification and plain-English reasoning
- All chat overrides and reclassifications

---

*Generated by License Clean-Up Agent on ${new Date().toLocaleDateString()}*
`;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createOnboardingRouter(upload: Multer) {
  const router = Router();

  // ── POST /onboard ──────────────────────────────────────────────────────────

  router.post(
    '/onboard',
    upload.fields([
      { name: 'usageFile', maxCount: 1 },
      { name: 'pastAnalysisFile', maxCount: 1 },
    ]),
    async (req: Request, res: Response) => {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const usageFile = files?.['usageFile']?.[0];

      if (!usageFile) {
        return res.status(400).json({ error: 'usageFile is required.' });
      }

      const { name, description } = req.body as { name?: string; description?: string };

      if (!name?.trim() || !description?.trim()) {
        return res.status(400).json({ error: 'name and description are required.' });
      }

      const usageData = extractCsvSample(usageFile.buffer);

      let pastHeaders: string[] = [];
      let pastSample: Record<string, string>[] = [];
      const pastFile = files?.['pastAnalysisFile']?.[0];
      if (pastFile) {
        const pastData = extractCsvSample(pastFile.buffer);
        pastHeaders = pastData.headers;
        pastSample = pastData.sample;
      }

      let reasoningTable: ReasoningTableContent;
      let usedMock = false;

      try {
        reasoningTable = await generateReasoningTableViaAI(
          name.trim(),
          description.trim(),
          usageData.headers,
          usageData.sample,
          pastHeaders,
          pastSample,
        );
      } catch {
        reasoningTable = buildMockReasoningTable(name.trim(), usageData.headers);
        usedMock = true;
      }

      return res.json({ reasoningTable, usedMock });
    },
  );

  // ── POST /onboard/confirm ─────────────────────────────────────────────────

  router.post('/onboard/confirm', async (req: Request, res: Response) => {
    const { name, description, foundationalNote, reasoningTable } = req.body as {
      name?: string;
      description?: string;
      foundationalNote?: string;
      reasoningTable?: ReasoningTableContent;
    };
    const confirmedByEmail = req.userEmail;

    if (!name?.trim() || !reasoningTable) {
      return res.status(400).json({ error: 'name and reasoningTable are required.' });
    }
    if (name.trim().length > 100 || !/^[a-zA-Z0-9\s\-_()]+$/.test(name.trim())) {
      return res.status(400).json({ error: 'System name must be 1–100 characters (letters, numbers, spaces, hyphens, underscores, parentheses).' });
    }
    if (description && description.length > 2000) {
      return res.status(400).json({ error: 'Description must be under 2,000 characters.' });
    }

    const existing = await prisma.system.findUnique({ where: { name: name.trim() } });
    if (existing) {
      return res.status(409).json({ error: `System "${name.trim()}" already exists.` });
    }

    const system = await prisma.system.create({
      data: {
        name: name.trim(),
        description: (description ?? '').trim(),
        foundationalNote: (foundationalNote ?? description ?? '').trim(),
        reasoningTable: {
          create: {
            content: reasoningTable as object,
            confirmedByEmail,
            confirmedAt: new Date(),
          },
        },
      },
      include: { reasoningTable: true, instanceConfigs: true },
    });

    return res.json(system);
  });

  // ── POST /:systemId/generate-docs ─────────────────────────────────────────

  router.post('/:systemId/generate-docs', async (req: Request, res: Response) => {
    const { systemId } = req.params;
    const { format = 'detailed' } = req.body as { format?: 'detailed' | 'summary' };

    const [system, exceptions, instanceConfigs] = await Promise.all([
      prisma.system.findUnique({
        where: { id: systemId },
        include: { reasoningTable: true },
      }),
      prisma.priorException.findMany({ where: { systemId }, orderBy: { createdAt: 'asc' } }),
      prisma.instanceConfig.findMany({ where: { systemId }, orderBy: { instanceName: 'asc' } }),
    ]);

    if (!system) {
      return res.status(404).json({ error: `System not found.` });
    }

    const rt = system.reasoningTable?.content as ReasoningTableContent | null;
    const fallbackMarkdown = buildDocumentationTemplate(system, rt, exceptions, instanceConfigs);

    if (!rt) {
      return res.json({ markdown: fallbackMarkdown, usedMock: true });
    }

    try {
      const prompt = `${SEED_FOUNDATIONAL_KNOWLEDGE}

---

Generate a ${format === 'summary' ? 'concise summary' : 'detailed'} formal documentation document in Markdown for the following system's license clean-up governance. Make it stakeholder-ready and professionally formatted.

## System: ${system.name}

**Description:** ${system.description}

**Reasoning Table:**
${JSON.stringify(rt, null, 2)}

**Instance Configurations:**
${JSON.stringify(instanceConfigs, null, 2)}

**Exception Register (${exceptions.length} entries):**
${JSON.stringify(exceptions, null, 2)}

---

Cover these sections with clear headings:
1. System Overview — what this system is, who uses it, business context
2. Access Criteria — who should have access and under what conditions
3. Inactivity Thresholds — per clean-up mode (Standard/Urgent/Critical) with the configured values
4. GTM Handling Rules — which roles require consultation, never auto-actioned
5. Exception Register — documented exceptions with justifications
6. Escalation Procedures — how borderline cases are handled
7. Audit Trail Requirements — what gets logged, where decisions are recorded

Return only the Markdown document.`;

      const markdown = await invokeModel(prompt);
      return res.json({ markdown, usedMock: false });
    } catch {
      return res.json({ markdown: fallbackMarkdown, usedMock: true });
    }
  });

  return router;
}
