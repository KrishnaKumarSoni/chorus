import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConversationStore } from './conversationStore';
import { SettingsStore } from './settingsStore';
import { CapabilityCache, FALLBACK_CONTEXT_WINDOW } from './capabilityCache';
import { DEFAULT_DEBATE_PROMPTS, LEGACY_DEBATE_PROMPTS } from '../../shared/consensus';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'chorus-')); });

describe('ConversationStore', () => {
  it('creates, appends turns with sequential indexes, and survives reload', async () => {
    const s = new ConversationStore(path.join(dir, 'conv'));
    await s.init();
    const c = await s.create('solo');
    const t0 = await s.appendTurn(c.id, { id: 'a', role: 'user', exchangeId: 'e', mode: 'solo', text: 'hi', createdAt: 'now', status: 'done' });
    const t1 = await s.appendTurn(c.id, { id: 'b', role: 'assistant', exchangeId: 'e', mode: 'solo', text: '', createdAt: 'now', status: 'streaming' });
    expect([t0.index, t1.index]).toEqual([0, 1]);
    await s.patchTurn(c.id, 'b', { text: 'hello', status: 'done' });
    const fresh = new ConversationStore(path.join(dir, 'conv'));
    const loaded = await fresh.get(c.id);
    expect(loaded?.turns[1]).toMatchObject({ text: 'hello', status: 'done', index: 1 });
    expect((await fresh.list())[0]).toMatchObject({ id: c.id, turnCount: 2 });
  });
  it('refuses to drop turns and marks sessions stale on reference removal', async () => {
    const s = new ConversationStore(path.join(dir, 'conv'));
    await s.init();
    const c = await s.create('compare');
    await s.appendTurn(c.id, { id: 'a', role: 'user', exchangeId: 'e', mode: 'solo', text: 'hi', createdAt: 'now', status: 'done' });
    await expect(s.update(c.id, (x) => { x.turns = []; })).rejects.toThrow('append-only');
    await s.setSession(c.id, 'claude', { id: 'sid', model: 'm', syncedThroughTurnIndex: 0, seenTurnIds: ['a'], referenceIds: [] });
    await s.addReference(c.id, { id: 'r', name: 'x.txt', mime: 'text/plain', size: 1, storedPath: '/x', kind: 'text' });
    expect((await s.get(c.id))!.references[0].addedAfterTurnIndex).toBe(0);
    await s.removeReference(c.id, 'r');
    expect((await s.get(c.id))!.sessions.claude?.stale).toBe(true);
  });
});

describe('SettingsStore', () => {
  it('upgrades untouched old default debate prompts but keeps custom ones', async () => {
    const file = path.join(dir, 'prompts.json');
    const legacy = LEGACY_DEBATE_PROMPTS[0];
    await fs.writeFile(file, JSON.stringify({ debatePrompts: { opening: legacy.opening, reply: 'My own reply rules for {other}.' } }));
    const v = await new SettingsStore(file).init();
    expect(v.debatePrompts.opening).toBe(DEFAULT_DEBATE_PROMPTS.opening);
    expect(v.debatePrompts.reply).toBe('My own reply rules for {other}.');
  });

  it('merges defaults, persists, and reloads', async () => {
    const s = new SettingsStore(path.join(dir, 'settings.json'));
    expect((await s.init()).soloProvider).toBe('claude');
    await s.set({ globalInstructions: 'terse', models: { claude: 'claude-opus-5' } as never });
    const again = new SettingsStore(path.join(dir, 'settings.json'));
    const v = await again.init();
    expect(v.globalInstructions).toBe('terse');
    expect(v.models).toEqual({ claude: 'claude-opus-5', codex: '' });
    expect(v.effort.codex).toBe('medium');
  });
});

describe('CapabilityCache', () => {
  it('falls back, seeds from catalog, and lets discovery win', async () => {
    const c = new CapabilityCache(path.join(dir, 'caps.json'));
    await c.init();
    expect(c.get('codex', 'gpt-5.5')).toMatchObject({ contextWindow: FALLBACK_CONTEXT_WINDOW, source: 'fallback' });
    await c.seed('codex', 'gpt-5.5', 272_000);
    expect(c.get('codex', 'gpt-5.5')).toMatchObject({ contextWindow: 272_000, source: 'catalog' });
    await c.discovered('codex', 'gpt-5.5', 300_000, 64_000);
    await c.seed('codex', 'gpt-5.5', 272_000);
    expect(c.get('codex', 'gpt-5.5')).toMatchObject({ contextWindow: 300_000, maxOutputTokens: 64_000, source: 'discovered' });
    await c.observe('codex', 'gpt-5.5', 100, 200);
    expect(c.get('codex', 'gpt-5.5').calibration).toBeGreaterThan(1);
    const again = new CapabilityCache(path.join(dir, 'caps.json'));
    await again.init();
    expect(again.get('codex', 'gpt-5.5').contextWindow).toBe(300_000);
  });
});
