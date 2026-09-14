import type { Capability, Compaction, Conversation, Turn } from '../../shared/types';
import { computeBudget, estimateTextTokens } from './tokens';
import { renderTranscript, renderTurn } from './render';

const VERBATIM_SHARE = 0.5;
const MIN_VERBATIM_EXCHANGES = 3;

export interface CompactionPlan {
  /** Turns to fold into the new summary (oldest first). Empty when nothing can be compacted. */
  toSummarize: Turn[];
  previousSummary?: string;
  throughTurnIndex: number;
}

/**
 * Decide which turns to fold into a summary so that the remaining verbatim
 * tail fits in half the budget, keeping at least the last few exchanges.
 */
export function planCompaction(conv: Conversation, capability: Capability, beforeTurnIndex: number): CompactionPlan | undefined {
  const budget = computeBudget(capability);
  const cal = capability.calibration || 1;
  const latest = conv.compactions.length ? conv.compactions[conv.compactions.length - 1] : undefined;
  const candidates = conv.turns.filter(
    (t) => t.index < beforeTurnIndex && t.status !== 'streaming' && (!latest || t.index > latest.throughTurnIndex),
  );
  if (candidates.length === 0) return undefined;

  // Walk backwards, keeping turns verbatim until they fill the share or we hit the minimum exchanges.
  const keep: Turn[] = [];
  let tokens = 0;
  const exchanges = new Set<string>();
  for (let i = candidates.length - 1; i >= 0; i--) {
    const t = candidates[i];
    const cost = estimateTextTokens(renderTurn(t), cal);
    const withinShare = tokens + cost <= budget * VERBATIM_SHARE;
    const underMinimum = exchanges.size < MIN_VERBATIM_EXCHANGES || exchanges.has(t.exchangeId);
    if (withinShare || underMinimum) {
      keep.unshift(t);
      tokens += cost;
      exchanges.add(t.exchangeId);
    } else break;
  }
  const toSummarize = candidates.slice(0, candidates.length - keep.length);
  if (toSummarize.length === 0) return undefined;
  return {
    toSummarize,
    previousSummary: latest?.summary,
    throughTurnIndex: toSummarize[toSummarize.length - 1].index,
  };
}

export const COMPACTION_SYSTEM = 'You compress chat history for a multi-model assistant. Output only the summary, no preamble.';

export function compactionPrompt(plan: CompactionPlan): string {
  const parts: string[] = [];
  parts.push(
    [
      'Summarise the conversation history below so a model that has not seen it can continue seamlessly.',
      'Write in dense prose or bullets, keep every proper noun, number, file name and quoted requirement exactly, and organise the result under these headings:',
      '1. Standing instructions the user gave in the chat',
      '2. Facts, figures and constraints established',
      '3. Decisions made (and by whom, if a specific model proposed them)',
      '4. Files, images and references mentioned (by name) and what they contained',
      '5. Open questions and unresolved disagreements — state each side',
      "6. The user's current goal and where the conversation left off",
      'If the history contains an earlier summary, merge it rather than repeating it.',
    ].join('\n'),
  );
  if (plan.previousSummary) parts.push(`<earlier-summary>\n${plan.previousSummary}\n</earlier-summary>`);
  parts.push(`<history>\n${renderTranscript(plan.toSummarize)}\n</history>`);
  return parts.join('\n\n');
}

export function makeCompaction(plan: CompactionPlan, summary: string, by: Compaction['by'], id: string, calibration = 1): Compaction {
  const before = estimateTextTokens(renderTranscript(plan.toSummarize), calibration) + estimateTextTokens(plan.previousSummary ?? '', calibration);
  return {
    id,
    throughTurnIndex: plan.throughTurnIndex,
    summary,
    createdAt: new Date().toISOString(),
    by,
    tokensBefore: before,
    tokensAfter: estimateTextTokens(summary, calibration),
  };
}
