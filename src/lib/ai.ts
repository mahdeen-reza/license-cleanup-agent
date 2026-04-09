/**
 * ai.ts
 *
 * Anthropic Claude API client for AI-powered classification and reasoning.
 *
 * Used by:
 *   - reasoningEngine.ts  (batch classification with reasoning)
 *   - chat.ts             (review chat + criteria chat)
 *   - onboarding.ts       (reasoning table generation + doc generation)
 */

import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  }
  return client;
}

/** Returns true if ANTHROPIC_API_KEY is set — used to gate AI calls */
export function isAIConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Sends a prompt to Claude and returns the text response.
 *
 * Uses claude-sonnet-4-20250514 by default for cost/speed balance on
 * batch classification workloads. Override via ANTHROPIC_MODEL env var.
 */
export async function invokeModel(prompt: string): Promise<string> {
  const anthropic = getClient();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';

  const message = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract text from the response content blocks
  const textBlocks = message.content.filter((b) => b.type === 'text');
  if (textBlocks.length === 0) {
    throw new Error('AI response contained no text content.');
  }

  return textBlocks.map((b) => b.text).join('\n');
}
