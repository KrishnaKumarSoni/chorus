import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Orchestrator } from './orchestrator';
import { ConversationStore } from '../store/conversationStore';
import { SettingsStore } from '../store/settingsStore';
import { CapabilityCache } from '../store/capabilityCache';
import type { Adapter, RunRequest, RunResult } from '../providers/types';
import type { Attachment, Provider, TurnEvent } from '../../shared/types';

class FakeAdapter implements Adapter {
  calls: RunRequest[] = [];
  failNext = 0;
  contextWindow = 150_000;
  reply: (req: RunRequest) => string = (r) => `${this.provider} says: ${lastText(r)}`;
  readonly resumeCarriesSystem = true;
  constructor(readonly provider: Provider) {}
  async status() { return { provider: this.provider, ok: true, detail: '', models: [] }; }
  async run(req: RunRequest, ev: { onDelta: (t: string) => void }): Promise<RunResult> {
    this.calls.push(req);
    if (req.signal.aborted) throw new Error('aborted');
    if (this.failNext > 0) { this.failNext--; throw new Error('boom'); }
    const text = this.reply(req);
    for (const piece of text.split(' ')) ev.onDelta(piece + ' ');
    return { text: text + ' ', sessionId: `${this.provider}-session`, usage: { input: req.packet.estimatedTokens + 50, output: 10 }, contextWindow: this.contextWindow };
  }
}
const lastText = (r: RunRequest) => { const b = r.packet.blocks[r.packet.blocks.length - 1]; return b.type === 'text' ? b.text : ''; };
const packetText = (r: RunRequest) => r.packet.blocks.map((b) => (b.type === 'text' ? b.text : '[img]')).join('\n');

let dir: string; let store: ConversationStore; let settings: SettingsStore; let caps: CapabilityCache;
let claude: FakeAdapter; let codex: FakeAdapter; let events: TurnEvent[]; let orch: Orchestrator;
const texts = new Map<string, string>();

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'chorus-orch-'));
  store = new ConversationStore(path.join(dir, 'conv')); await store.init();
  settings = new SettingsStore(path.join(dir, 's.json')); await settings.init();
  await settings.set({ models: { claude: 'claude-opus-5', codex: 'gpt-5.5' }, globalInstructions: 'Be terse.' });
  caps = new CapabilityCache(path.join(dir, 'caps.json')); await caps.init();
  claude = new FakeAdapter('claude'); codex = new FakeAdapter('codex'); events = [];
  orch = new Orchestrator({
    store, settings, caps, adapters: { claude, codex }, workRoot: path.join(dir, 'work'), emit: (e) => events.push(e),
    attachments: { text: (a: Attachment) => texts.get(a.id), warm: async () => undefined, readBase64: async () => 'AAAA' },
  });
});

describe('Orchestrator', () => {
  it('solo: appends user + assistant turns, streams, stores session and discovered capability', async () => {
    const c = await store.create('solo');
    await orch.send({ conversationId: c.id, text: 'hello there', mode: 'solo', attachmentIds: [] }, []);
    const conv = (await store.get(c.id))!;
    expect(conv.title).toBe('hello there');
    expect(conv.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(conv.turns[1]).toMatchObject({ status: 'done', author: { provider: 'claude', model: 'claude-opus-5' } });
    expect(conv.turns[1].text).toContain('claude says: hello there');
    expect(conv.sessions.claude).toMatchObject({ id: 'claude-session', seenTurnIds: [conv.turns[0].id, conv.turns[1].id] });
    expect(caps.get('claude', 'claude-opus-5')).toMatchObject({ contextWindow: 150_000, source: 'discovered' });
    expect(claude.calls[0].packet.kind).toBe('fresh');
    expect(claude.calls[0].packet.system).toContain('Be terse.');
    expect(events.filter((e) => e.type === 'turn-delta').length).toBeGreaterThan(1);
    expect(events[events.length - 1].type).toBe('conversation-updated');
  });

  it('solo follow-up resumes with no catch-up, then compare brings the other model up to date', async () => {
    const c = await store.create('solo');
    await orch.send({ conversationId: c.id, text: 'first', mode: 'solo', attachmentIds: [] }, []);
    await orch.send({ conversationId: c.id, text: 'second', mode: 'solo', attachmentIds: [] }, []);
    expect(claude.calls[1].packet.kind).toBe('resume');
    expect(packetText(claude.calls[1])).toBe('second');
    await orch.send({ conversationId: c.id, text: 'third', mode: 'compare', attachmentIds: [] }, []);
    expect(codex.calls[0].packet.kind).toBe('fresh');
    expect(packetText(codex.calls[0])).toContain('claude says: first');
    expect(packetText(codex.calls[0])).toContain('### User\nsecond');
    const conv = (await store.get(c.id))!;
    expect(conv.turns.filter((t) => t.exchangeId === conv.turns[conv.turns.length - 1].exchangeId).map((t) => t.author?.provider)).toEqual([undefined, 'claude', 'codex']);
    // next solo turn on claude must include codex's compare reply as catch-up
    await orch.send({ conversationId: c.id, text: 'fourth', mode: 'solo', attachmentIds: [] }, []);
    const last = claude.calls[claude.calls.length - 1];
    expect(last.packet.kind).toBe('resume');
    expect(packetText(last)).toContain('codex says: third');
    expect(packetText(last)).not.toContain('claude says: third');
  });

  it('consensus: two answers, two critiques, one synthesis by the chair, all in the shared transcript', async () => {
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const conv = (await store.get(c.id))!;
    const a = conv.turns.filter((t) => t.role === 'assistant');
    expect(a.map((t) => [t.author?.provider, t.round, t.kind])).toEqual([
      ['claude', 1, 'answer'], ['codex', 1, 'answer'], ['claude', 2, 'critique'], ['codex', 2, 'critique'], ['claude', 3, 'synthesis'],
    ]);
    // round 2 for codex saw claude's round-1 answer but not its own; the message is the critique instruction
    const codexR2 = codex.calls[1];
    expect(codexR2.packet.kind).toBe('resume');
    expect(packetText(codexR2)).toContain('claude says: decide');
    expect(packetText(codexR2)).not.toContain('codex says: decide');
    expect(lastText(codexR2)).toContain('Agree');
    const synth = claude.calls[2];
    expect(packetText(synth)).toContain('codex says:');
    expect(lastText(synth)).toContain('Unresolved');
  });

  it('retries once with a fresh packet when a resumed session fails, then records the error', async () => {
    const c = await store.create('solo');
    await orch.send({ conversationId: c.id, text: 'a', mode: 'solo', attachmentIds: [] }, []);
    claude.failNext = 1;
    await orch.send({ conversationId: c.id, text: 'b', mode: 'solo', attachmentIds: [] }, []).catch(() => undefined);
    expect(claude.calls[1].packet.kind).toBe('resume');
    expect(claude.calls[2].packet.kind).toBe('fresh');
    let conv = (await store.get(c.id))!;
    expect(conv.turns[3].status).toBe('done');
    claude.failNext = 2;
    await expect(orch.send({ conversationId: c.id, text: 'c', mode: 'solo', attachmentIds: [] }, [])).rejects.toThrow('boom');
    conv = (await store.get(c.id))!;
    expect(conv.turns[5]).toMatchObject({ status: 'error', error: 'boom' });
    expect(conv.sessions.claude).toBeUndefined();
  });

  it('compacts older history when the fresh packet exceeds the budget', async () => {
    claude.contextWindow = 60_000;
    claude.reply = () => 'x'.repeat(20_000);
    const c = await store.create('solo');
    for (let i = 0; i < 6; i++) await orch.send({ conversationId: c.id, text: `q${i} ` + 'y'.repeat(3000), mode: 'solo', attachmentIds: [] }, []);
    // force a fresh rebuild by dropping the session
    await store.setSession(c.id, 'claude', undefined);
    claude.reply = (r) => (r.packet.system.includes('compress') ? 'SUMMARY OF OLD TURNS' : 'final');
    await orch.send({ conversationId: c.id, text: 'q6', mode: 'solo', attachmentIds: [] }, []);
    const conv = (await store.get(c.id))!;
    expect(conv.compactions).toHaveLength(1);
    expect(conv.compactions[0].summary).toBe('SUMMARY OF OLD TURNS');
    const compactionCall = claude.calls.find((r) => r.packet.system.includes('compress'))!;
    expect(compactionCall.workDir).toContain('compaction');
    const finalCall = claude.calls[claude.calls.length - 1];
    expect(packetText(finalCall)).toContain('<compacted-history');
    expect(packetText(finalCall)).toContain('SUMMARY OF OLD TURNS');
    expect(finalCall.packet.estimatedTokens).toBeLessThanOrEqual(finalCall.packet.budget);
  });

  it('cancel marks the streaming turn as cancelled and keeps partial text', async () => {
    const c = await store.create('solo');
    claude.run = async (req, ev) => { ev.onDelta('partial '); await new Promise<void>((_, rej) => req.signal.addEventListener('abort', () => rej(new Error('aborted')))); throw new Error('unreachable'); };
    const p = orch.send({ conversationId: c.id, text: 'go', mode: 'solo', attachmentIds: [] }, []).catch((e) => e);
    await new Promise((r) => setTimeout(r, 20));
    expect(orch.isBusy(c.id)).toBe(true);
    orch.cancel(c.id);
    await p;
    const conv = (await store.get(c.id))!;
    expect(conv.turns[1]).toMatchObject({ status: 'cancelled', text: 'partial ' });
  });

  it('passes message attachments and conversation references to both providers identically', async () => {
    const c = await store.create('compare');
    const ref = { id: 'ref', name: 'strategy.pdf', mime: 'application/pdf', size: 1, storedPath: '/x', kind: 'pdf' } as Attachment;
    texts.set('ref', 'REFERENCE BODY');
    await store.addReference(c.id, ref);
    const img = { id: 'img', name: 'shot.png', mime: 'image/png', size: 1, storedPath: '/y', kind: 'image' } as Attachment;
    await orch.send({ conversationId: c.id, text: 'why?', mode: 'compare', attachmentIds: ['img'] }, [img]);
    for (const a of [claude, codex]) {
      const t = packetText(a.calls[0]);
      expect(t).toContain('<file name="strategy.pdf">\nREFERENCE BODY');
      expect(t).toContain('[img]');
      expect(t.endsWith('why?')).toBe(true);
    }
    expect(claude.calls[0].packet.referenceIds).toEqual(['ref']);
  });
});
