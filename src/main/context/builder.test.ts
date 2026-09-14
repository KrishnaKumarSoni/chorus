import { describe, it, expect } from 'vitest';
import { buildPacket, buildSystemPrompt, hashString, type BuildOptions } from './builder';
import type { Attachment, Capability, Conversation, Turn } from '../../shared/types';

const cap: Capability = { contextWindow: 200_000, calibration: 1, source: 'fallback' };
const author = { provider: 'claude' as const, model: 'claude-opus-5' };
const mkTurn = (index: number, role: 'user' | 'assistant', text: string, extra: Partial<Turn> = {}): Turn => ({
  id: `t${index}`, index, role, text, exchangeId: `e${Math.floor(index / 2)}`, mode: 'solo', createdAt: 'now', status: 'done', ...extra,
});
const mkConv = (turns: Turn[], extra: Partial<Conversation> = {}): Conversation => ({
  id: 'c', title: 't', createdAt: 'now', updatedAt: 'now', instructions: '', references: [], turns, compactions: [], sessions: {}, mode: 'solo', ...extra,
});
const texts: Record<string, string> = {};
const readText = (a: Attachment) => texts[a.id];
const base = (conv: Conversation, current: Turn, extra: Partial<BuildOptions> = {}): BuildOptions => ({
  conversation: conv, target: author, capability: cap, globalInstructions: 'Be terse.', currentTurn: current, resumeCarriesSystem: true, readText, ...extra,
});

describe('buildPacket', () => {
  it('builds a fresh packet with system prompt, history and the current message', () => {
    const t0 = mkTurn(0, 'user', 'first');
    const t1 = mkTurn(1, 'assistant', 'reply', { author });
    const cur = mkTurn(2, 'user', 'second');
    const conv = mkConv([t0, t1, cur], { instructions: 'Assume a fintech PM.' });
    const p = buildPacket(base(conv, cur));
    expect(p.kind).toBe('fresh');
    expect(p.system).toContain('Be terse.');
    expect(p.system).toContain('Assume a fintech PM.');
    const text = p.blocks.map((b) => (b.type === 'text' ? b.text : '[img]')).join('\n');
    expect(text).toContain('<history>');
    expect(text).toContain('### User\nfirst');
    expect(text).toContain('### Claude · claude-opus-5\nreply');
    expect(p.blocks[p.blocks.length - 1]).toEqual({ type: 'text', text: 'second' });
    expect(p.needsCompaction).toBe(false);
    expect(p.syncedThroughTurnIndex).toBe(2);
    expect(p.seenTurnIds).toEqual(['t0', 't1', 't2']);
  });

  it('resumes with only the unseen turns as catch-up, including the other model', () => {
    const t0 = mkTurn(0, 'user', 'q1');
    const t1 = mkTurn(1, 'assistant', 'a1 claude', { author });
    const t2 = mkTurn(2, 'assistant', 'a1 gpt', { author: { provider: 'codex', model: 'gpt-5.5' }, mode: 'compare' });
    const cur = mkTurn(3, 'user', 'q2');
    const conv = mkConv([t0, t1, t2, cur]);
    const session = { id: 's', model: 'claude-opus-5', syncedThroughTurnIndex: 1, seenTurnIds: ['t0', 't1'], referenceIds: [] };
    const p = buildPacket(base(conv, cur, { session }));
    expect(p.kind).toBe('resume');
    const text = p.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain('<transcript-catch-up>');
    expect(text).toContain('a1 gpt');
    expect(text).not.toContain('a1 claude');
    expect(text).not.toContain('q1');
  });

  it('catches up on a reply that landed before its own (compare ordering) and supports message override', () => {
    const t0 = mkTurn(0, 'user', 'q1');
    const t1 = mkTurn(1, 'assistant', 'claude first', { author, mode: 'compare' });
    const t2 = mkTurn(2, 'assistant', 'gpt second', { author: { provider: 'codex', model: 'gpt-5.5' }, mode: 'compare' });
    const conv = mkConv([t0, t1, t2]);
    // codex session saw t0 and its own t2, but not claude's t1 which has a lower index
    const session = { id: 's', model: 'gpt-5.5', syncedThroughTurnIndex: 2, seenTurnIds: ['t0', 't2'], referenceIds: [] };
    const p = buildPacket(base(conv, t0, { session, target: { provider: 'codex', model: 'gpt-5.5' }, messageOverride: 'Now critique.' }));
    expect(p.kind).toBe('resume');
    const text = p.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain('claude first');
    expect(text).not.toContain('gpt second');
    expect(p.blocks[p.blocks.length - 1]).toEqual({ type: 'text', text: 'Now critique.' });
    expect(p.seenTurnIds).toEqual(['t1', 't2', 't0']);
  });

  it('sends no catch-up when the session is current', () => {
    const t0 = mkTurn(0, 'user', 'q1');
    const t1 = mkTurn(1, 'assistant', 'a1', { author });
    const cur = mkTurn(2, 'user', 'q2');
    const p = buildPacket(base(mkConv([t0, t1, cur]), cur, { session: { id: 's', model: 'claude-opus-5', syncedThroughTurnIndex: 1, seenTurnIds: ['t0', 't1'], referenceIds: [] } }));
    expect(p.kind).toBe('resume');
    expect(p.blocks).toEqual([{ type: 'text', text: 'q2' }]);
  });

  it('falls back to fresh when the session is stale, on another model, or system changed for a baked transport', () => {
    const cur = mkTurn(0, 'user', 'q');
    const conv = mkConv([cur]);
    const s = { id: 's', model: 'claude-opus-5', syncedThroughTurnIndex: -1, seenTurnIds: [], referenceIds: [] };
    expect(buildPacket(base(conv, cur, { session: { ...s, stale: true } })).kind).toBe('fresh');
    expect(buildPacket(base(conv, cur, { session: { ...s, model: 'claude-sonnet-5' } })).kind).toBe('fresh');
    const sys = buildSystemPrompt('Be terse.', '');
    expect(buildPacket(base(conv, cur, { session: { ...s, systemHash: hashString(sys) }, resumeCarriesSystem: false })).kind).toBe('resume');
    expect(buildPacket(base(conv, cur, { session: { ...s, systemHash: 'nope' }, resumeCarriesSystem: false })).kind).toBe('fresh');
  });

  it('includes conversation references (text and images) and only new ones on resume', () => {
    const pdf = { id: 'r1', name: 'strategy.pdf', kind: 'pdf' } as Attachment;
    const img = { id: 'r2', name: 'product.png', kind: 'image' } as Attachment;
    texts.r1 = 'PRICING STRATEGY CONTENT';
    const cur = mkTurn(0, 'user', 'which strategy?');
    const conv = mkConv([cur], { references: [pdf, img] });
    const fresh = buildPacket(base(conv, cur));
    expect(fresh.blocks[0].type).toBe('text');
    expect((fresh.blocks[0] as { text: string }).text).toContain('<file name="strategy.pdf">');
    expect(fresh.blocks.some((b) => b.type === 'image' && b.attachment.id === 'r2')).toBe(true);
    expect(fresh.referenceIds).toEqual(['r1', 'r2']);

    const seen = buildPacket(base(conv, cur, { session: { id: 's', model: 'claude-opus-5', syncedThroughTurnIndex: -1, seenTurnIds: [], referenceIds: ['r1', 'r2'] } }));
    expect(seen.blocks).toEqual([{ type: 'text', text: 'which strategy?' }]);
    const partial = buildPacket(base(conv, cur, { session: { id: 's', model: 'claude-opus-5', syncedThroughTurnIndex: -1, seenTurnIds: [], referenceIds: ['r1'] } }));
    expect(partial.blocks.map((b) => b.type)).toEqual(['image', 'text']);
  });

  it('attaches message-scoped files to the current message and appends a round instruction', () => {
    const md = { id: 'm1', name: 'notes.md', kind: 'text' } as Attachment;
    const shot = { id: 'm2', name: 'shot.png', kind: 'image' } as Attachment;
    texts.m1 = '# notes';
    const cur = mkTurn(0, 'user', 'why confusing?', { attachments: [md, shot] });
    const p = buildPacket(base(mkConv([cur]), cur, { roundInstruction: 'Critique the other answer.' }));
    expect(p.blocks.map((b) => b.type)).toEqual(['text', 'image', 'text', 'text']);
    expect((p.blocks[0] as { text: string }).text).toContain('<attachments>');
    expect(p.blocks[3]).toEqual({ type: 'text', text: 'Critique the other answer.' });
  });

  it('uses the latest compaction summary and only turns after it', () => {
    const turns = [mkTurn(0, 'user', 'old q'), mkTurn(1, 'assistant', 'old a', { author }), mkTurn(2, 'user', 'new q'), mkTurn(3, 'assistant', 'new a', { author })];
    const cur = mkTurn(4, 'user', 'latest');
    const conv = mkConv([...turns, cur], { compactions: [{ id: 'k', throughTurnIndex: 1, summary: 'SUMMARY', createdAt: 'now', by: author, tokensBefore: 10, tokensAfter: 2 }] });
    const p = buildPacket(base(conv, cur));
    const text = p.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain('<compacted-history through-turn="1">\nSUMMARY');
    expect(text).not.toContain('old q');
    expect(text).toContain('new q');
  });

  it('flags compaction when a fresh packet exceeds the budget', () => {
    const small: Capability = { contextWindow: 20_000, calibration: 1, source: 'fallback' };
    const turns = Array.from({ length: 10 }, (_, i) => mkTurn(i, i % 2 ? 'assistant' : 'user', 'x'.repeat(4000), i % 2 ? { author } : {}));
    const cur = mkTurn(10, 'user', 'q');
    const p = buildPacket(base(mkConv([...turns, cur]), cur, { capability: small }));
    expect(p.kind).toBe('fresh');
    expect(p.estimatedTokens).toBeGreaterThan(p.budget);
    expect(p.needsCompaction).toBe(true);
  });

  it('caps references to a share of the budget and reports truncation', () => {
    const small: Capability = { contextWindow: 20_000, calibration: 1, source: 'fallback' };
    const big = { id: 'b', name: 'big.txt', kind: 'text' } as Attachment;
    texts.b = 'z'.repeat(100_000);
    const cur = mkTurn(0, 'user', 'q');
    const p = buildPacket(base(mkConv([cur], { references: [big] }), cur, { capability: small }));
    expect(p.truncatedReferenceIds).toEqual(['b']);
    expect((p.blocks[0] as { text: string }).text).toContain('truncated');
  });
});
