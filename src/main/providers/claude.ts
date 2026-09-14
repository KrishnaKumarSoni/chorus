import { query, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ModelDescriptor, ProviderStatus } from '../../shared/types';
import { ProviderError, cleanEnv, type Adapter, type RunEvents, type RunRequest, type RunResult } from './types';

type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMime; data: string } };

const AUTH_RE = /authenticat|oauth|not logged in|401|api key/i;

export class ClaudeAdapter implements Adapter {
  readonly provider = 'claude' as const;
  readonly resumeCarriesSystem = true;
  private modelCache?: ModelDescriptor[];

  private baseOptions(): Options {
    return {
      tools: [],
      settingSources: [],
      mcpServers: {},
      permissionMode: 'dontAsk',
      env: cleanEnv(),
    };
  }

  private authOk?: boolean;

  /**
   * Listing models works even when the login has expired, so the status check
   * also sends one tiny request. Cached per launch; "Re-check providers" clears it.
   */
  async status(refresh = false): Promise<ProviderStatus> {
    let models: ModelDescriptor[] = [];
    try {
      models = await this.listModels();
    } catch (e) {
      return { provider: 'claude', ok: false, detail: (e as Error).message, models: [] };
    }
    if (refresh || this.authOk === undefined) this.authOk = await this.probeAuth();
    return this.authOk
      ? { provider: 'claude', ok: true, detail: `${models.length} models available to this account`, models }
      : { provider: 'claude', ok: false, detail: 'Not signed in. Run `claude login` in a terminal, then re-check.', models };
  }

  private async probeAuth(): Promise<boolean> {
    try {
      const q = query({ prompt: 'Reply with exactly: OK', options: { ...this.baseOptions(), effort: 'low', maxTurns: 1, systemPrompt: { type: 'custom', prompt: 'Reply with OK.' } } });
      for await (const m of q as AsyncIterable<SDKMessage>) {
        if (m.type === 'result') return !m.is_error;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Ask the harness which models this account can use; the process is opened only long enough to answer. */
  async listModels(): Promise<ModelDescriptor[]> {
    if (this.modelCache) return this.modelCache;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    async function* idle(): AsyncGenerator<SDKUserMessage> {
      await gate;
    }
    const q = query({ prompt: idle(), options: { ...this.baseOptions(), maxTurns: 1 } });
    try {
      const models = await q.supportedModels();
      this.modelCache = models.map<ModelDescriptor>((m, i) => ({
        provider: 'claude',
        id: m.value,
        label: m.displayName,
        efforts: m.supportedEffortLevels,
        isDefault: i === 0,
      }));
      return this.modelCache;
    } finally {
      release();
      q.close();
    }
  }

  async run(req: RunRequest, events: RunEvents): Promise<RunResult> {
    const content: ContentBlock[] = [];
    for (const b of req.packet.blocks) {
      if (b.type === 'text') content.push({ type: 'text', text: b.text });
      else {
        const { base64, mime } = await req.readImage(b.attachment);
        content.push({ type: 'image', source: { type: 'base64', media_type: mime as ImageMime, data: base64 } });
      }
    }
    const userMessage: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: content as never },
      parent_tool_use_id: null,
      session_id: req.session?.id ?? '',
    } as SDKUserMessage;

    async function* once(): AsyncGenerator<SDKUserMessage> {
      yield userMessage;
    }

    const options: Options = {
      ...this.baseOptions(),
      model: req.model,
      effort: req.effort,
      systemPrompt: { type: 'custom', prompt: req.packet.system },
      includePartialMessages: true,
      maxTurns: 1,
      resume: req.packet.kind === 'resume' && req.session ? req.session.id : undefined,
      abortController: abortFrom(req.signal),
    };

    const q = query({ prompt: once(), options });
    let text = '';
    let sessionId = req.session?.id ?? '';
    let usage: RunResult['usage'];
    let contextWindow: number | undefined;
    let maxOutputTokens: number | undefined;
    let nativeCompaction = false;
    let failure: string | undefined;

    for await (const m of q as AsyncIterable<SDKMessage>) {
      if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
      else if (m.type === 'system' && m.subtype === 'compact_boundary') {
        nativeCompaction = true;
        events.onActivity('Claude compacted its context');
      } else if (m.type === 'stream_event') {
        const ev = m.event;
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          text += ev.delta.text;
          events.onDelta(ev.delta.text);
        } else if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') events.onActivity('Thinking');
      } else if (m.type === 'assistant' && m.error) {
        failure = typeof m.error === 'string' ? m.error : JSON.stringify(m.error);
      } else if (m.type === 'result') {
        sessionId = m.session_id;
        const mu = m.modelUsage?.[req.model] ?? Object.values(m.modelUsage ?? {})[0];
        if (mu) {
          usage = { input: mu.inputTokens, output: mu.outputTokens, cachedInput: mu.cacheReadInputTokens };
          contextWindow = mu.contextWindow;
          maxOutputTokens = mu.maxOutputTokens;
        }
        if (m.is_error || m.subtype !== 'success') {
          const msg = m.subtype === 'success' ? m.result : `${m.subtype}`;
          throw new ProviderError(msg, AUTH_RE.test(msg) ? 'Run `claude login` in a terminal, then try again.' : undefined, AUTH_RE.test(msg));
        }
        if (!text && m.subtype === 'success') text = m.result;
      }
    }
    if (failure && !text) throw new ProviderError(failure);
    return { text, sessionId, usage, contextWindow, maxOutputTokens, nativeCompaction };
  }
}

function abortFrom(signal: AbortSignal): AbortController {
  const ac = new AbortController();
  if (signal.aborted) ac.abort();
  else signal.addEventListener('abort', () => ac.abort(), { once: true });
  return ac;
}
