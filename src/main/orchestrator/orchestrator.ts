import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Attachment, Author, Conversation, Mode, Provider, SendRequest, Turn, TurnEvent, TurnKind } from '../../shared/types';
import { buildPacket, hashString, type Packet } from '../context/builder';
import { compactionPrompt, COMPACTION_SYSTEM, makeCompaction, planCompaction } from '../context/compaction';
import { estimateTextTokens } from '../context/tokens';
import type { AttachmentService } from '../attachments/service';
import type { CapabilityCache } from '../store/capabilityCache';
import type { ConversationStore } from '../store/conversationStore';
import type { SettingsStore } from '../store/settingsStore';
import type { Adapter, RunRequest } from '../providers/types';
import { CRITIQUE_INSTRUCTION, SYNTHESIS_INSTRUCTION, titleFrom } from './prompts';

export interface OrchestratorDeps {
  store: ConversationStore;
  settings: SettingsStore;
  caps: CapabilityCache;
  attachments: Pick<AttachmentService, 'text' | 'warm' | 'readBase64'>;
  adapters: Record<Provider, Adapter>;
  workRoot: string;
  emit: (e: TurnEvent) => void;
}

interface RunSpec {
  provider: Provider;
  round?: number;
  kind?: TurnKind;
  roundInstruction?: string;
  messageOverride?: string;
}

const other = (p: Provider): Provider => (p === 'claude' ? 'codex' : 'claude');

export class Orchestrator {
  private inflight = new Map<string, AbortController>();

  constructor(private readonly deps: OrchestratorDeps) {}

  isBusy(conversationId: string): boolean {
    return this.inflight.has(conversationId);
  }

  cancel(conversationId: string): void {
    this.inflight.get(conversationId)?.abort();
  }

  /** Append the user's turn and run the requested mode to completion. */
  async send(req: SendRequest, attachments: Attachment[]): Promise<string> {
    const { store, emit } = this.deps;
    if (this.inflight.has(req.conversationId)) throw new Error('This conversation is still replying. Cancel it first.');
    const ac = new AbortController();
    this.inflight.set(req.conversationId, ac);
    const exchangeId = randomUUID();
    try {
      const before = await store.get(req.conversationId);
      if (!before) throw new Error('conversation not found');
      const userTurn = await store.appendTurn(req.conversationId, {
        id: randomUUID(), role: 'user', exchangeId, mode: req.mode, text: req.text, createdAt: new Date().toISOString(), status: 'done',
        attachments: attachments.length ? attachments : undefined,
      });
      await store.update(req.conversationId, (c) => {
        c.mode = req.mode;
        if (c.turns.length === 1) c.title = titleFrom(req.text);
      });
      emit({ type: 'turn-start', conversationId: req.conversationId, turn: userTurn });
      emit({ type: 'conversation-updated', conversationId: req.conversationId });

      await this.deps.attachments.warm([...(before.references ?? []), ...attachments]);
      await this.runMode(req.mode, req.conversationId, userTurn, exchangeId, ac.signal);
    } finally {
      this.inflight.delete(req.conversationId);
      emit({ type: 'exchange-done', conversationId: req.conversationId, exchangeId });
      emit({ type: 'conversation-updated', conversationId: req.conversationId });
    }
    return exchangeId;
  }

  private async runMode(mode: Mode, conversationId: string, userTurn: Turn, exchangeId: string, signal: AbortSignal): Promise<void> {
    const settings = this.deps.settings.get();
    const both: Provider[] = ['claude', 'codex'];
    if (mode === 'solo') {
      await this.runOne(conversationId, userTurn, exchangeId, mode, { provider: settings.soloProvider }, signal);
      return;
    }
    if (mode === 'compare') {
      await Promise.allSettled(both.map((p) => this.runOne(conversationId, userTurn, exchangeId, mode, { provider: p }, signal)));
      return;
    }
    // consensus
    const r1 = await Promise.allSettled(both.map((p) => this.runOne(conversationId, userTurn, exchangeId, mode, { provider: p, round: 1, kind: 'answer' }, signal)));
    if (signal.aborted) return;
    const answered = both.filter((_, i) => r1[i].status === 'fulfilled');
    if (answered.length < 2) return; // one side failed: its error turn already explains; no round to reconcile
    await Promise.allSettled(
      both.map((p) => this.runOne(conversationId, userTurn, exchangeId, mode, { provider: p, round: 2, kind: 'critique', messageOverride: CRITIQUE_INSTRUCTION }, signal)),
    );
    if (signal.aborted) return;
    const chair = settings.consensusChair;
    try {
      await this.runOne(conversationId, userTurn, exchangeId, mode, { provider: chair, round: 3, kind: 'synthesis', messageOverride: SYNTHESIS_INSTRUCTION }, signal);
    } catch {
      if (signal.aborted) return;
      await this.runOne(conversationId, userTurn, exchangeId, mode, { provider: other(chair), round: 3, kind: 'synthesis', messageOverride: SYNTHESIS_INSTRUCTION }, signal).catch(() => undefined);
    }
  }

  private async runOne(conversationId: string, userTurn: Turn, exchangeId: string, mode: Mode, spec: RunSpec, signal: AbortSignal): Promise<Turn> {
    const { store, settings, caps, adapters, emit } = this.deps;
    const adapter = adapters[spec.provider];
    const model = settings.get().models[spec.provider];
    if (!model) throw await this.fail(conversationId, exchangeId, mode, spec, { provider: spec.provider, model: '' }, `No ${spec.provider} model selected. Choose one in Settings.`);
    const author: Author = { provider: spec.provider, model };
    const turn = await store.appendTurn(conversationId, {
      id: randomUUID(), role: 'assistant', exchangeId, mode, text: '', createdAt: new Date().toISOString(), status: 'streaming', author, round: spec.round, kind: spec.kind, activity: [],
    });
    emit({ type: 'turn-start', conversationId, turn });

    let text = '';
    const events = {
      onDelta: (t: string) => {
        text += t;
        emit({ type: 'turn-delta', conversationId, turnId: turn.id, text: t });
      },
      onActivity: (label: string) => {
        turn.activity!.push(label);
        emit({ type: 'turn-activity', conversationId, turnId: turn.id, label });
      },
    };

    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const conv = (await store.get(conversationId))!;
      const session = conv.sessions[spec.provider];
      let packet = this.build(conv, userTurn, author, adapter, spec);
      if (packet.needsCompaction) {
        packet = await this.compactAndRebuild(conv, userTurn, author, adapter, spec, signal, events.onActivity);
      }
      const req: RunRequest = {
        conversationId, model, effort: settings.get().effort[spec.provider], packet,
        session: packet.kind === 'resume' ? session : undefined, signal,
        workDir: path.join(this.deps.workRoot, conversationId),
        readImage: async (a) => ({ base64: await this.deps.attachments.readBase64(a), mime: a.mime }),
      };
      try {
        const result = await adapter.run(req, events);
        if (result.contextWindow) await caps.discovered(spec.provider, model, result.contextWindow, result.maxOutputTokens);
        // Harness overhead (its own system prompt and tools) dominates small requests; only large packets teach us anything.
        if (packet.kind === 'fresh' && result.usage && packet.estimatedTokens >= 10_000) {
          const actual = result.usage.input + (result.usage.cachedInput ?? 0);
          await caps.observe(spec.provider, model, packet.estimatedTokens + estimateTextTokens(packet.system), actual);
        }
        const finalText = text || result.text;
        await store.setSession(conversationId, spec.provider, {
          id: result.sessionId, model, syncedThroughTurnIndex: Math.max(packet.syncedThroughTurnIndex, turn.index),
          seenTurnIds: [...packet.seenTurnIds, turn.id], referenceIds: packet.referenceIds, systemHash: hashString(packet.system),
        });
        const done = await store.patchTurn(conversationId, turn.id, { text: finalText, status: 'done', usage: result.usage, activity: turn.activity });
        emit({ type: 'turn-done', conversationId, turn: done });
        return done;
      } catch (e) {
        const err = e as Error & { hint?: string };
        lastError = err.hint ? `${err.message} ${err.hint}` : err.message || String(e);
        if (signal.aborted) {
          const cancelled = await store.patchTurn(conversationId, turn.id, { text, status: 'cancelled', activity: turn.activity });
          emit({ type: 'turn-done', conversationId, turn: cancelled });
          throw new Error('cancelled');
        }
        if (attempt === 0 && packet.kind === 'resume') {
          events.onActivity('Session could not be resumed; rebuilding from the transcript');
          await store.setSession(conversationId, spec.provider, undefined);
          continue;
        }
        break;
      }
    }
    const failed = await store.patchTurn(conversationId, turn.id, { text, status: 'error', error: lastError, activity: turn.activity });
    emit({ type: 'turn-done', conversationId, turn: failed });
    throw new Error(lastError);
  }

  private async fail(conversationId: string, exchangeId: string, mode: Mode, spec: RunSpec, author: Author, message: string): Promise<Error> {
    const turn = await this.deps.store.appendTurn(conversationId, {
      id: randomUUID(), role: 'assistant', exchangeId, mode, text: '', createdAt: new Date().toISOString(), status: 'error', error: message, author, round: spec.round, kind: spec.kind,
    });
    this.deps.emit({ type: 'turn-done', conversationId, turn });
    return new Error(message);
  }

  private build(conv: Conversation, userTurn: Turn, author: Author, adapter: Adapter, spec: RunSpec): Packet {
    return buildPacket({
      conversation: conv, target: author, capability: this.deps.caps.get(author.provider, author.model),
      globalInstructions: this.deps.settings.get().globalInstructions, currentTurn: userTurn,
      roundInstruction: spec.roundInstruction, messageOverride: spec.messageOverride, session: conv.sessions[author.provider],
      resumeCarriesSystem: adapter.resumeCarriesSystem, readText: (a) => this.deps.attachments.text(a),
    });
  }

  private async compactAndRebuild(conv: Conversation, userTurn: Turn, author: Author, adapter: Adapter, spec: RunSpec, signal: AbortSignal, onActivity: (l: string) => void): Promise<Packet> {
    const { store, caps } = this.deps;
    const cap = caps.get(author.provider, author.model);
    const plan = planCompaction(conv, cap, Number.MAX_SAFE_INTEGER);
    if (!plan) return this.build(conv, userTurn, author, adapter, spec);
    onActivity(`Compacting ${plan.toSummarize.length} older turns`);
    const prompt = compactionPrompt(plan);
    const packet: Packet = {
      kind: 'fresh', system: COMPACTION_SYSTEM, blocks: [{ type: 'text', text: prompt }], estimatedTokens: estimateTextTokens(prompt), budget: 0,
      needsCompaction: false, syncedThroughTurnIndex: -1, seenTurnIds: [], referenceIds: [], truncatedReferenceIds: [], warnings: [],
    };
    try {
      const result = await adapter.run(
        { conversationId: conv.id, model: author.model, effort: 'low', packet, signal, workDir: path.join(this.deps.workRoot, conv.id, 'compaction'), readImage: async () => ({ base64: '', mime: '' }) },
        { onDelta: () => undefined, onActivity: () => undefined },
      );
      const summary = result.text.trim();
      if (!summary) throw new Error('empty compaction summary');
      await store.addCompaction(conv.id, makeCompaction(plan, summary, author, randomUUID(), cap.calibration));
      onActivity('Compacted older history');
    } catch (e) {
      onActivity(`Compaction failed (${(e as Error).message}); sending the most recent turns only`);
      // Fallback: drop the oldest turns via a synthetic, clearly labelled compaction record.
      await store.addCompaction(conv.id, makeCompaction(plan, '(Older history could not be summarised and was omitted from the model context. It remains in the transcript.)', author, randomUUID(), cap.calibration));
    }
    const fresh = (await store.get(conv.id))!;
    return this.build(fresh, userTurn, author, adapter, spec);
  }
}
