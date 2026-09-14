import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Codex, type ThreadEvent, type ThreadOptions, type UserInput } from '@openai/codex-sdk';
import type { Effort, ProviderStatus } from '../../shared/types';
import { readCodexModels, codexHome } from './codexCatalog';
import { ProviderError, cleanEnv, type Adapter, type RunEvents, type RunRequest, type RunResult } from './types';

function mapEffort(e: Effort): ThreadOptions['modelReasoningEffort'] {
  return e === 'max' ? 'xhigh' : e;
}

export class CodexAdapter implements Adapter {
  readonly provider = 'codex' as const;
  readonly resumeCarriesSystem = false;
  private codex = new Codex({ env: cleanEnv() });

  async status(): Promise<ProviderStatus> {
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
    await fs.mkdir(req.workDir, { recursive: true });
    // Codex has no per-request system prompt; project instructions come from AGENTS.md in the working directory.
    await fs.writeFile(path.join(req.workDir, 'AGENTS.md'), req.packet.system, 'utf8');

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
