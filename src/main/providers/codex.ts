import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Codex, type ThreadEvent, type ThreadOptions, type UserInput } from '@openai/codex-sdk';
import type { Effort, ProviderStatus } from '../../shared/types';
import { readCodexModels, codexHome, readConfiguredModel } from './codexCatalog';
import { ProviderError, cleanEnv, type Adapter, type RunEvents, type RunRequest, type RunResult } from './types';

function mapEffort(e: Effort): ThreadOptions['modelReasoningEffort'] {
  return e === 'max' ? 'xhigh' : e;
}

/**
 * Chorus runs Codex from its own CODEX_HOME so the user's global AGENTS.md,
 * skills and MCP servers do not leak into chat replies. Only the auth file is
 * shared (symlinked), so token refreshes stay in one place.
 */
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
  const lines = ['# Managed by Chorus. Edit ~/.codex/config.toml for your own Codex setup.', model ? `model = "${model}"` : '', 'notify = []', ''];
  await fs.writeFile(path.join(appHome, 'config.toml'), lines.filter((l) => l !== undefined).join('\n'), 'utf8');
  // Models catalog: reuse the user's cache when present so context windows are known before the first turn.
  try {
    await fs.copyFile(path.join(userHome, 'models_cache.json'), path.join(appHome, 'models_cache.json'));
  } catch {
    /* no cache yet */
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

  async status(): Promise<ProviderStatus> {
    await this.ensureHome();
    const models = await readCodexModels();
    let ok = false;
    let detail = '';
    try {
      await fs.access(path.join(codexHome(), 'auth.json'));
      ok = true;
      detail = models.length ? `${models.length} models from the Codex catalog` : 'Signed in; no model catalog yet';
    } catch {
      detail = 'Not signed in. Run `codex login` in a terminal.';
    }
    return { provider: 'codex', ok, detail, models };
  }

  async run(req: RunRequest, events: RunEvents): Promise<RunResult> {
    await this.ensureHome();
    await fs.mkdir(req.workDir, { recursive: true });
    // Codex has no per-request system prompt; project instructions come from AGENTS.md in the working directory.
    await fs.writeFile(path.join(req.workDir, 'AGENTS.md'), `${req.packet.system}\n\n## Operating notes\nThis is a chat, not a coding task. Answer directly from the conversation and the provided material; do not run shell commands or read files unless the user explicitly asks you to.\n`, 'utf8');

    const opts: ThreadOptions = {
      model: req.model,
      modelReasoningEffort: mapEffort(req.effort),
      sandboxMode: 'read-only',
      skipGitRepoCheck: true,
      workingDirectory: req.workDir,
      webSearchMode: 'disabled',
      approvalPolicy: 'never',
    };
    const thread = req.packet.kind === 'resume' && req.session ? this.codex.resumeThread(req.session.id, opts) : this.codex.startThread(opts);

    const input: UserInput[] = req.packet.blocks.map((b) =>
      b.type === 'text' ? { type: 'text', text: b.text } : { type: 'local_image', path: b.attachment.storedPath },
    );

    const { events: stream } = await thread.runStreamed(input, { signal: req.signal });
    const messages = new Map<string, string>();
    const order: string[] = [];
    let usage: RunResult['usage'];
    let threadId: string | null = null;

    const applyMessage = (id: string, text: string) => {
      const prev = messages.get(id) ?? '';
      if (!messages.has(id)) order.push(id);
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
          else if (ev.item.type === 'web_search') events.onActivity(`Searched: ${ev.item.query}`);
          else if (ev.item.type === 'error') events.onActivity(`Error: ${ev.item.message}`);
          break;
        case 'turn.completed':
          usage = { input: ev.usage.input_tokens, output: ev.usage.output_tokens, cachedInput: ev.usage.cached_input_tokens };
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
    return { text, sessionId, usage };
  }
}

function isAuthFailure(msg: string): boolean {
  return /unauthori[sz]ed|401|not logged in|login|auth/i.test(msg);
}
function authHint(msg: string): string | undefined {
  return isAuthFailure(msg) ? 'Run `codex login` in a terminal, then try again.' : undefined;
}
