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
  delayMs = 0;
  contextWindow = 150_000;
  reply: (req: RunRequest) => string = (r) => `${this.provider} says: ${lastText(r)}`;
  readonly resumeCarriesSystem = true;
  constructor(readonly provider: Provider) {}
  async status() { return { provider: this.provider, ok: true, detail: '', models: [] }; }
  async limits() { return { provider: this.provider, windows: [], checkedAt: '' }; }
  async run(req: RunRequest, ev: { onDelta: (t: string) => void }): Promise<RunResult> {
    this.calls.push(req);
    if (req.signal.aborted) throw new Error('aborted');
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext > 0) { this.failNext--; throw new Error('boom'); }
    const text = this.reply(req);
    for (const piece of text.split(' ')) ev.onDelta(piece + ' ');
    return { text: text + ' ', sessionId: `${this.provider}-session`, usage: { input: req.packet.estimatedTokens + 50, output: 10 }, contextWindow: this.contextWindow };
  }
}
const lastText = (r: RunRequest) => { const b = r.packet.blocks[r.packet.blocks.length - 1]; return b.type === 'text' ? b.text : ''; };
const packetText = (r: RunRequest) => r.packet.blocks.map((b) => (b.type === 'text' ? b.text : '[img]')).join('\n');

const debate = <T extends { role: string; kind?: string }>(turns: T[]) => turns.filter((t) => t.role === 'assistant' && t.kind !== 'synthesis');
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

  it('consensus: both answer independently, then critiques alternate from the first critic', async () => {
    await settings.set({ consensusStarter: 'codex', consensusMaxTurns: 6 });
    claude.reply = () => `claude turn ${claude.calls.length}`;
    codex.reply = () => `codex turn ${codex.calls.length}`;
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const all = (await store.get(c.id))!.turns.filter((t) => t.role === 'assistant');
    const a = debate(all) as typeof all;
    expect(a.map((t) => [t.author?.provider, t.round])).toEqual([
      ['codex', 1], ['claude', 2], ['codex', 3], ['claude', 4], ['codex', 5], ['claude', 6],
    ]);
    expect(a.every((t) => t.kind === undefined)).toBe(true);
    expect(a.map((t) => !!t.independent)).toEqual([true, true, false, false, false, false]);
    // One summary at the end, by the model that did not have the last word.
    expect(all[all.length - 1]).toMatchObject({ kind: 'synthesis', author: { provider: 'codex' }, status: 'done' });
    // Openings: neither sees the other's opening; neither is told to look for agreement.
    expect(packetText(claude.calls[0])).not.toContain('codex turn 1');
    expect(packetText(codex.calls[0])).not.toContain('claude turn 1');
    expect(packetText(claude.calls[0])).not.toContain('[[AGREED]]');
    // Turn 3 (first critic) sees the other opening and is asked to critique under the agreement rule.
    expect(packetText(codex.calls[1])).toContain('claude turn 1');
    expect(lastText(codex.calls[1])).toContain('Continue the debate');
    expect(lastText(codex.calls[1])).toContain('material objection');
    // With no state written (these fake replies carry none), turn 4 falls back to every argument so far.
    expect(packetText(claude.calls[1])).toContain('codex turn 1');
    expect(packetText(claude.calls[1])).toContain('codex turn 2');
    // Critique turns run in fresh threads and leave the stored sessions at the openings.
    expect(codex.calls[1].packet.kind).toBe('fresh');
    expect(codex.calls[1].session).toBeUndefined();
    const conv = (await store.get(c.id))!;
    expect(conv.sessions.codex!.seenTurnIds).toContain(a[0].id);
    expect(conv.sessions.codex!.seenTurnIds).not.toContain(a[2].id);
  });

  it('consensus opening stays blind to the other opening even when rebuilt after it finished', async () => {
    await settings.set({ consensusStarter: 'codex', consensusMaxTurns: 2 });
    codex.reply = () => 'CHATGPT OPENING SECRET';
    const c = await store.create('solo');
    await orch.send({ conversationId: c.id, text: 'earlier', mode: 'solo', attachmentIds: [] }, []); // gives Claude a live session
    // Claude's first attempt is slow and fails, so its retry is built after ChatGPT's opening is done.
    claude.delayMs = 30;
    claude.failNext = 1;
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const conv = (await store.get(c.id))!;
    const openingDoneFirst = conv.turns.find((t) => t.author?.provider === 'codex')!;
    expect(openingDoneFirst.status).toBe('done');
    const claudeOpenings = claude.calls.slice(1, 3); // then the summary check
    expect(claudeOpenings).toHaveLength(2);
    expect(claudeOpenings[0].packet.kind).toBe('resume');
    for (const r of claudeOpenings) expect(packetText(r)).not.toContain('CHATGPT OPENING SECRET');
    expect(conv.sessions.claude!.seenTurnIds).not.toContain(openingDoneFirst.id);
  });

  it('consensus openings receive the same request, references and prior conversation', async () => {
    await settings.set({ consensusStarter: 'claude', consensusMaxTurns: 2, debatePrompts: { opening: 'Answer alone; {other} answers separately.', reply: 'Critique {other}.' } });
    const c = await store.create('consensus');
    const ref: Attachment = { id: 'r1', name: 'brief.md', mime: 'text/markdown', size: 10, storedPath: '/x', kind: 'text' };
    texts.set('r1', 'REFERENCE BODY');
    await store.addReference(c.id, ref);
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const [cl, cx] = [claude.calls[0], codex.calls[0]];
    expect(cl.packet.system).toBe(cx.packet.system);
    expect(cl.packet.kind).toBe(cx.packet.kind);
    const neutral = (r: RunRequest) => packetText(r).replace(/Claude|ChatGPT/g, 'OTHER');
    expect(neutral(cl)).toBe(neutral(cx));
    expect(packetText(cl)).toContain('REFERENCE BODY');
    expect(packetText(cl)).toContain('decide');
  });

  it('announces session changes after each reply, not only when the exchange ends', async () => {
    await settings.set({ consensusStarter: 'codex', consensusMaxTurns: 2 });
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const types = events.filter((e) => e.conversationId === c.id).map((e) => e.type);
    const firstDone = types.indexOf('turn-done');
    expect(types[firstDone + 1]).toBe('conversation-updated');
    expect(types.indexOf('conversation-updated', firstDone)).toBeLessThan(types.indexOf('exchange-done'));
  });

  it('passes the web access setting to the harness', async () => {
    await settings.set({ soloProvider: 'claude', webAccess: false });
    const c = await store.create('solo');
    await orch.send({ conversationId: c.id, text: 'hi', mode: 'solo', attachmentIds: [] }, []);
    await settings.set({ webAccess: true });
    await orch.send({ conversationId: c.id, text: 'again', mode: 'solo', attachmentIds: [] }, []);
    expect(claude.calls.map((r) => r.webAccess)).toEqual([false, true]);
  });

  it('consensus uses custom debate prompts; only critique turns carry the agreement rule', async () => {
    await settings.set({ consensusStarter: 'codex', consensusMaxTurns: 3, debatePrompts: { opening: 'Argue the opposite of {other}.', reply: 'Rebut {other} in one line.' } });
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    expect(packetText(codex.calls[0])).toContain('Argue the opposite of Claude.');
    expect(packetText(claude.calls[0])).toContain('Argue the opposite of ChatGPT.');
    expect(packetText(codex.calls[0])).not.toContain('[[AGREED]]');
    expect(lastText(codex.calls[1])).toContain('Rebut Claude in one line.');
    expect(lastText(codex.calls[1])).toContain('no material objection survives');
    expect(lastText(codex.calls[1])).toContain('not evidence by itself');
    expect(lastText(codex.calls[1])).toContain('<chorus-state>');
  });

  it('agreement markers cannot end the independent openings, then two in a row end the debate', async () => {
    await settings.set({ consensusStarter: 'claude', consensusMaxTurns: 10 });
    claude.reply = () => 'Agreed, $20 it is. [[AGREED]]';
    codex.reply = () => 'Same conclusion. [[AGREED]]';
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const all = (await store.get(c.id))!.turns.filter((t) => t.role === 'assistant');
    const a = debate(all) as typeof all;
    expect(a.map((t) => t.author?.provider)).toEqual(['claude', 'codex', 'claude', 'codex']);
    expect(a.map((t) => !!t.agreed)).toEqual([false, false, true, true]);
    expect(all).toHaveLength(5);
    expect(all[4]).toMatchObject({ kind: 'synthesis', agreed: false });
    expect(lastText(claude.calls[claude.calls.length - 1])).toContain('both found no remaining material objection');
    expect(a[0].text).toBe('Agreed, $20 it is.');
    expect(a.some((t) => t.text.includes('AGREED'))).toBe(false);
  });

  it('consensus never forces agreement and stops at the turn cap', async () => {
    await settings.set({ consensusStarter: 'claude', consensusMaxTurns: 4 });
    claude.reply = () => 'I still disagree.';
    codex.reply = () => 'And I still disagree.';
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const all = (await store.get(c.id))!.turns.filter((t) => t.role === 'assistant');
    const a = debate(all) as typeof all;
    expect(a.map((t) => t.author?.provider)).toEqual(['claude', 'codex', 'claude', 'codex']);
    expect(a.some((t) => t.agreed)).toBe(false);
    expect(lastText(claude.calls[claude.calls.length - 1])).toContain('without full agreement');
  });

  it('consensus does not end on one model agreeing alone', async () => {
    await settings.set({ consensusStarter: 'claude', consensusMaxTurns: 6 });
    claude.reply = () => 'Fine by me. [[AGREED]]';
    codex.reply = () => 'No, I disagree.';
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const a = debate((await store.get(c.id))!.turns);
    expect(a).toHaveLength(6);
    expect(a.map((t) => !!t.agreed)).toEqual([false, false, true, false, true, false]);
  });

  it('critiques read the openings, the latest valid state, their own last turn and the latest argument', async () => {
    await settings.set({ consensusStarter: 'claude', consensusMaxTurns: 6 });
    let n = 0;
    const state = (k: number) => `QUESTION: q\nPOSITIONS: x\nAGREED: none\nOPEN DISAGREEMENTS: none\nCHANGES SO FAR: STATE-${k}`;
    const reply = (who: string) => (r: RunRequest) => {
      if (/Reply with exactly ACCURATE/.test(lastText(r))) return 'ACCURATE';
      n++;
      // Turn 5 writes a malformed state, which must be ignored.
      const block = n === 5 ? 'garbage' : state(n);
      return `${who} ARGUMENT-${n} reasoning\n<chorus-state>\n${block}\n</chorus-state>`;
    };
    claude.reply = reply('claude');
    codex.reply = reply('codex');
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const conv = (await store.get(c.id))!;
    const a = debate(conv.turns) as typeof conv.turns;
    const arg = (t: (typeof a)[number]) => t.text.split(' ')[1];
    expect(a[2].text).not.toContain('chorus-state');
    expect(a[2].state).toContain('STATE-3');
    // Turn 5 (Claude): state from turn 4, both openings, its own turn 3, ChatGPT's turn 4.
    const t5 = packetText(claude.calls[2]);
    expect(t5).toContain('STATE-4');
    expect(t5).toContain(arg(a[0]));
    expect(t5).toContain(arg(a[1]));
    expect(t5).toContain(arg(a[2]));
    expect(t5).toContain(arg(a[3]));
    expect(t5).toContain('rewrite only your own POSITIONS line');
    // Turn 6 (ChatGPT): turn 5's state was malformed, so it falls back to turn 4's state plus turns 4 and 5 verbatim.
    const t6 = packetText(codex.calls[2]); // opening, turn 4, turn 6, then the summary check
    expect(t6).toContain('STATE-4');
    expect(t6).not.toContain('garbage');
    expect(t6).toContain(arg(a[4]));
    // Summary by Claude (ChatGPT had the last word), checked by ChatGPT.
    const summary = conv.turns.find((t) => t.kind === 'synthesis')!;
    expect(summary.author?.provider).toBe('claude');
    expect(packetText(claude.calls[claude.calls.length - 1])).toContain('## Final positions, in their own words');
    expect(summary.review).toEqual({ by: 'codex', status: 'accurate' });
    expect(codex.calls[codex.calls.length - 1].effort).toBe('low');
    expect(summary.completedAt).toBeTruthy();
  });

  it('attaches the checking model\'s corrections to the summary', async () => {
    await settings.set({ consensusStarter: 'claude', consensusMaxTurns: 4 }); // ChatGPT has the last word, so Claude writes and ChatGPT checks
    codex.reply = (r) => (/Reply with exactly ACCURATE/.test(lastText(r)) ? 'CORRECTIONS\n- It says I agreed on pricing; I did not.' : 'codex view');
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const summary = (await store.get(c.id))!.turns.find((t) => t.kind === 'synthesis')!;
    expect(summary.review).toEqual({ by: 'codex', status: 'corrections', notes: '- It says I agreed on pricing; I did not.' });
  });

  it('a failed opening ends the run without starting the debate', async () => {
    await settings.set({ consensusStarter: 'claude', consensusMaxTurns: 6 });
    codex.failNext = 2;
    const c = await store.create('consensus');
    await orch.send({ conversationId: c.id, text: 'decide', mode: 'consensus', attachmentIds: [] }, []);
    const a = (await store.get(c.id))!.turns.filter((t) => t.role === 'assistant');
    expect(a.map((t) => [t.author?.provider, t.status])).toEqual([['claude', 'done'], ['codex', 'error']]); // no critique, no summary
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
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    claude.run = (req, ev) => {
      ev.onDelta('partial ');
      started();
      return new Promise<never>((_, rej) => {
        if (req.signal.aborted) return rej(new Error('aborted'));
        req.signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
      });
    };
    const p = orch.send({ conversationId: c.id, text: 'go', mode: 'solo', attachmentIds: [] }, []).catch((e) => e);
    await running; // wait for the adapter to actually be in flight, rather than racing a timer
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
