import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Codex, type ThreadEvent, type ThreadOptions, type UserInput } from '@openai/codex-sdk';
import type { Effort, ProviderLimits, ProviderStatus, Usage } from '../../shared/types';
import { codexRequest } from './codexAppServer';
import { codexWindows } from './limits';
import { readCodexModels, codexHome, readConfiguredModel, refreshCodexCatalog } from './codexCatalog';
import { ProviderError, cleanEnv, type Adapter, type RunEvents, type RunRequest, type RunResult } from './types';

/**
 * Codex reports token usage as running totals for the whole thread. Subtract
 * the totals recorded after the previous reply to get what this reply used.
 */
export function perReplyUsage(totals: Usage, previous?: Usage): Usage {
  if (!previous || previous.input > totals.input) return totals;
  return {
    input: totals.input - previous.input,
    output: totals.output - previous.output,
    cachedInput: (totals.cachedInput ?? 0) - (previous.cachedInput ?? 0),
  };
}

function mapEffort(e: Effort): ThreadOptions['modelReasoningEffort'] {
  return e === 'max' ? 'xhigh' : e;
}

/**
 * Chorus runs Codex from its own CODEX_HOME so the user's global AGENTS.md,
 * skills and MCP servers do not leak into chat replies. Only the auth file is
 * shared (symlinked), so token refreshes stay in one place.
 */
/** Codex features a chat app never uses (measured: 12.6k → 9.5k input tokens per request). */
export const CHAT_UNUSED_FEATURES = ['apps', 'plugins', 'image_generation', 'goals', 'tool_suggest', 'shell_tool', 'view_image', 'sleep_tool'];

export async function prepareCodexHome(appHome: string): Promise<string> {
  await fs.mkdir(appHome, { recursive: true });
  const userHome = codexHome();
  const link = path.join(appHome, 'auth.json');
  try {
    await fs.lstat(link);
  } catch {
    try {
      await fs.symlink(path.join(userHome, 'auth.json'), link);
    } catch {
      /* not signed in yet; status() reports it */
    }
  }
  const model = await readConfiguredModel(userHome);
  const lines = [
    '# Managed by Chorus. Edit ~/.codex/config.toml for your own Codex setup.',
    model ? `model = "${model}"` : '',
    'notify = []',
    '',
    // Chorus is a chat: switch off tools it never uses. Each one adds instructions to
    // every request; together they are about a quarter of Codex's fixed overhead.
    '[features]',
    ...CHAT_UNUSED_FEATURES.map((f) => `${f} = false`),
    '',
  ];
  await fs.writeFile(path.join(appHome, 'config.toml'), lines.filter((l) => l !== undefined).join('\n'), 'utf8');
  // Seed the models catalog from the user's cache on first run only; status() refreshes it with the bundled Codex.
  try {
    await fs.copyFile(path.join(userHome, 'models_cache.json'), path.join(appHome, 'models_cache.json'), fs.constants.COPYFILE_EXCL);
  } catch {
    /* already seeded, or no cache yet */
  }
  return appHome;
}

export class CodexAdapter implements Adapter {
  readonly provider = 'codex' as const;
  readonly resumeCarriesSystem = false;
  private codex: Codex;
  private home: string;

  constructor(appHome = path.join(os.homedir(), '.chorus', 'codex-home')) {
    this.home = appHome;
    this.codex = new Codex({ env: { ...cleanEnv(), CODEX_HOME: appHome } });
  }

  private ready?: Promise<string>;
  private ensureHome(): Promise<string> {
    if (!this.ready) this.ready = prepareCodexHome(this.home);
    return this.ready;
  }

  private catalogRefreshed = false;

  async status(refresh = false): Promise<ProviderStatus> {
    await this.ensureHome();
    if (refresh || !this.catalogRefreshed) {
      await refreshCodexCatalog(this.home, cleanEnv());
      this.catalogRefreshed = true;
    }
    const models = await readCodexModels(this.home);
    let ok = false;
    let detail = '';
    try {
      await fs.access(path.join(codexHome(), 'auth.json'));
      ok = true;
      detail = models.length ? `${models.length} models from the Codex catalog` : 'Signed in; no model catalog yet';
    } catch {
      detail = 'Not signed in yet. Use the Sign in button below.';
    }
    return { provider: 'codex', ok, detail, models };
  }

  async limits(): Promise<ProviderLimits> {
    const checkedAt = new Date().toISOString();
    await this.ensureHome();
    try {
      const r = await codexRequest<{ rateLimits?: { planType?: string | null; primary?: never; secondary?: never } }>('account/rateLimits/read', undefined, { ...cleanEnv(), CODEX_HOME: this.home });
      const plan = r.rateLimits?.planType ? r.rateLimits.planType[0].toUpperCase() + r.rateLimits.planType.slice(1) : undefined;
      const windows = codexWindows(r.rateLimits);
      return { provider: 'codex', plan, windows, note: windows.length ? undefined : 'ChatGPT did not report any limits.', checkedAt };
    } catch (e) {
      return { provider: 'codex', windows: [], note: `Unable to read limits: ${(e as Error).message}`, checkedAt };
    }
  }

  async run(req: RunRequest, events: RunEvents): Promise<RunResult> {
    await this.ensureHome();
    await fs.mkdir(req.workDir, { recursive: true });
    // Codex has no per-request system prompt; project instructions come from AGENTS.md in the working directory.
    const web = req.webAccess ? ' Search the web when the answer depends on current or outside facts, and say where a fact came from.' : ' You have no web access in this chat; say so if the answer needs current facts.';
    await fs.writeFile(path.join(req.workDir, 'AGENTS.md'), `${req.packet.system}\n\n## Operating notes\nThis is a chat, not a coding task. Answer directly from the conversation and the provided material; do not run shell commands or read files unless the user explicitly asks you to.${web}\n`, 'utf8');

    const opts: ThreadOptions = {
      model: req.model,
      modelReasoningEffort: mapEffort(req.effort),
      sandboxMode: 'read-only',
      skipGitRepoCheck: true,
      workingDirectory: req.workDir,
      webSearchMode: req.webAccess ? 'live' : 'disabled',
      approvalPolicy: 'never',
    };
    const thread = req.packet.kind === 'resume' && req.session ? this.codex.resumeThread(req.session.id, opts) : this.codex.startThread(opts);

    const input: UserInput[] = req.packet.blocks.map((b) =>
      b.type === 'text' ? { type: 'text', text: b.text } : { type: 'local_image', path: b.attachment.storedPath },
    );

    const { events: stream } = await thread.runStreamed(input, { signal: req.signal });
    const messages = new Map<string, string>();
    const order: string[] = [];
    let totals: Usage | undefined;
    let threadId: string | null = null;

    const applyMessage = (id: string, text: string) => {
      const prev = messages.get(id) ?? '';
      if (!messages.has(id)) {
        // A new message (e.g. the answer after a "let me check" remark) starts its own paragraph.
        if (order.some((o) => messages.get(o))) events.onDelta('\n\n');
        order.push(id);
      }
      messages.set(id, text);
      if (text.startsWith(prev)) {
        if (text.length > prev.length) events.onDelta(text.slice(prev.length));
      } else {
        // The item was rewritten; re-emit as a fresh paragraph so nothing is lost.
        events.onDelta(`\n${text}`);
      }
    };

    for await (const ev of stream as AsyncGenerator<ThreadEvent>) {
      switch (ev.type) {
        case 'thread.started':
          threadId = ev.thread_id;
          break;
        case 'item.started':
        case 'item.updated':
        case 'item.completed':
          if (ev.item.type === 'agent_message') applyMessage(ev.item.id, ev.item.text);
          else if (ev.item.type === 'reasoning') events.onActivity('Thinking');
          else if (ev.item.type === 'command_execution') events.onActivity(`Ran: ${ev.item.command.slice(0, 60)}`);
          else if (ev.item.type === 'web_search') events.onActivity(ev.item.query ? `Searching the web for “${ev.item.query.slice(0, 60)}”` : 'Searching the web');
          else if (ev.item.type === 'mcp_tool_call') events.onActivity(`Using ${ev.item.tool}`);
          else if (ev.item.type === 'error') events.onActivity(`Error: ${ev.item.message}`);
          break;
        case 'turn.completed':
          totals = { input: ev.usage.input_tokens, output: ev.usage.output_tokens, cachedInput: ev.usage.cached_input_tokens };
          break;
        case 'turn.failed':
          throw new ProviderError(ev.error.message, authHint(ev.error.message), isAuthFailure(ev.error.message));
        case 'error':
          throw new ProviderError(ev.message, authHint(ev.message), isAuthFailure(ev.message));
      }
    }
    const text = order.map((id) => messages.get(id) ?? '').filter(Boolean).join('\n\n');
    const sessionId = threadId ?? thread.id;
    if (!sessionId) throw new ProviderError('Codex did not report a thread id');
    // A resumed thread continues its totals; a new thread starts from zero.
    const previous = req.packet.kind === 'resume' && req.session?.id === sessionId ? req.session.usageTotals : undefined;
    return { text, sessionId, usage: totals && perReplyUsage(totals, previous), usageTotals: totals };
  }
}

function isAuthFailure(msg: string): boolean {
  return /unauthori[sz]ed|401|not logged in|login|auth/i.test(msg);
}
function authHint(msg: string): string | undefined {
  return isAuthFailure(msg) ? 'Run `codex login` in a terminal, then try again.' : undefined;
}
