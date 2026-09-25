import { query, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ModelDescriptor, ProviderLimits, ProviderStatus } from '../../shared/types';
import { claudeWindows } from './limits';
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
    if (refresh) this.modelCache = undefined;
    try {
      models = await this.listModels();
    } catch (e) {
      return { provider: 'claude', ok: false, detail: (e as Error).message, models: [] };
    }
    if (refresh || this.authOk === undefined) this.authOk = await this.probeAuth();
    return this.authOk
      ? { provider: 'claude', ok: true, detail: `${models.length} models available to this account`, models }
      : { provider: 'claude', ok: false, detail: 'Not signed in yet. Use the Sign in button below.', models };
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
        description: m.description,
        efforts: m.supportsEffort ? m.supportedEffortLevels : [],
        isDefault: i === 0,
      }));
      return this.modelCache;
    } finally {
      release();
      q.close();
    }
  }

  /** Plan usage from the harness's /usage data; the process is opened only long enough to answer. */
  async limits(): Promise<ProviderLimits> {
    const checkedAt = new Date().toISOString();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    async function* idle(): AsyncGenerator<SDKUserMessage> {
      await gate;
    }
    const q = query({ prompt: idle(), options: { ...this.baseOptions(), maxTurns: 1 } });
    try {
      const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      const plan = u.subscription_type ? u.subscription_type[0].toUpperCase() + u.subscription_type.slice(1) : undefined;
      if (!u.rate_limits_available) return { provider: 'claude', plan, windows: [], note: 'This sign-in has no plan limits to show.', checkedAt };
      const windows = claudeWindows(u.rate_limits as Parameters<typeof claudeWindows>[0]);
      return { provider: 'claude', plan, windows, note: windows.length ? undefined : 'Claude did not report any limits.', checkedAt };
    } catch (e) {
      return { provider: 'claude', windows: [], note: `Unable to read limits: ${(e as Error).message}`, checkedAt };
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

    const webTools = req.webAccess ? ['WebSearch', 'WebFetch'] : [];
    const options: Options = {
      ...this.baseOptions(),
      tools: webTools,
      allowedTools: webTools,
      model: req.model,
      effort: req.effort,
      systemPrompt: { type: 'custom', prompt: req.webAccess ? `${req.packet.system}\n\nSearch the web when the answer depends on current or outside facts, and say where a fact came from.` : req.packet.system },
      includePartialMessages: true,
      // Searching takes a few model turns (search, read, answer); without tools one is enough.
      maxTurns: req.webAccess ? 12 : 1,
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
        } else if (ev.type === 'content_block_start' && ev.content_block.type === 'text' && text && !text.endsWith('\n\n')) {
          // Text after a tool call starts a new paragraph rather than running on.
          text += '\n\n';
          events.onDelta('\n\n');
        } else if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') events.onActivity('Thinking');
        else if (ev.type === 'content_block_start' && (ev.content_block.type === 'server_tool_use' || ev.content_block.type === 'tool_use')) {
          events.onActivity(/fetch/i.test(ev.content_block.name) ? 'Reading a web page' : 'Searching the web');
        }
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
