import { describe, it, expect } from 'vitest';
import { planCompaction, compactionPrompt, makeCompaction } from './compaction';
import type { Capability, Conversation, Turn } from '../../shared/types';

const author = { provider: 'codex' as const, model: 'gpt-5.5' };
const mkTurn = (index: number, text: string): Turn => ({
  id: `t${index}`, index, role: index % 2 ? 'assistant' : 'user', text, exchangeId: `e${Math.floor(index / 2)}`, mode: 'solo', createdAt: 'now', status: 'done', author: index % 2 ? author : undefined,
});
const conv = (turns: Turn[], compactions: Conversation['compactions'] = []): Conversation => ({
  id: 'c', title: 't', createdAt: 'now', updatedAt: 'now', instructions: '', references: [], turns, compactions, sessions: {}, mode: 'solo',
});

describe('planCompaction', () => {
  it('keeps the recent tail verbatim and folds the rest', () => {
    const cap: Capability = { contextWindow: 20_000, calibration: 1, source: 'fallback' };
    const turns = Array.from({ length: 20 }, (_, i) => mkTurn(i, 'x'.repeat(2000)));
    const plan = planCompaction(conv(turns), cap, 20)!;
    expect(plan).toBeDefined();
    expect(plan.toSummarize.length).toBeGreaterThan(0);
    expect(plan.toSummarize.length).toBeLessThan(20);
    // the last three exchanges (6 turns) are always kept verbatim
    expect(plan.throughTurnIndex).toBeLessThanOrEqual(13);
    expect(plan.toSummarize[0].index).toBe(0);
  });
  it('never breaks an exchange in half', () => {
    const cap: Capability = { contextWindow: 20_000, calibration: 1, source: 'fallback' };
    const turns = Array.from({ length: 20 }, (_, i) => mkTurn(i, 'x'.repeat(2000)));
    const plan = planCompaction(conv(turns), cap, 20)!;
    expect(plan.throughTurnIndex % 2).toBe(1);
  });
  it('returns undefined when there is nothing older than the minimum tail', () => {
    const cap: Capability = { contextWindow: 20_000, calibration: 1, source: 'fallback' };
    const turns = Array.from({ length: 6 }, (_, i) => mkTurn(i, 'x'.repeat(5000)));
    expect(planCompaction(conv(turns), cap, 6)).toBeUndefined();
  });
  it('starts after the previous compaction and carries its summary', () => {
    const cap: Capability = { contextWindow: 20_000, calibration: 1, source: 'fallback' };
    const turns = Array.from({ length: 30 }, (_, i) => mkTurn(i, 'x'.repeat(2000)));
    const prev = { id: 'k', throughTurnIndex: 9, summary: 'OLD', createdAt: 'now', by: author, tokensBefore: 1, tokensAfter: 1 };
    const plan = planCompaction(conv(turns, [prev]), cap, 30)!;
    expect(plan.toSummarize[0].index).toBe(10);
    expect(plan.previousSummary).toBe('OLD');
    const prompt = compactionPrompt(plan);
    expect(prompt).toContain('<earlier-summary>\nOLD');
    expect(prompt).toContain('unresolved disagreements');
    const c = makeCompaction(plan, 'NEW', author, 'id');
    expect(c.throughTurnIndex).toBe(plan.throughTurnIndex);
    expect(c.tokensAfter).toBe(1);
  });
});
