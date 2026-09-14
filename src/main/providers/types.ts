import type { Attachment, Effort, HarnessSession, Provider, ProviderStatus, Usage } from '../../shared/types';
import type { Packet } from '../context/builder';

export interface RunRequest {
  conversationId: string;
  model: string;
  effort: Effort;
  packet: Packet;
  /** Present when packet.kind === 'resume'. */
  session?: HarnessSession;
  signal: AbortSignal;
  /** Per-conversation scratch directory (Codex cwd, AGENTS.md). */
  workDir: string;
  readImage: (att: Attachment) => Promise<{ base64: string; mime: string }>;
}

export interface RunEvents {
  onDelta: (text: string) => void;
  onActivity: (label: string) => void;
}

export interface RunResult {
  text: string;
  sessionId: string;
  usage?: Usage;
  contextWindow?: number;
  maxOutputTokens?: number;
  nativeCompaction?: boolean;
}

export interface Adapter {
  readonly provider: Provider;
  /** True when the transport re-sends the system prompt on every resumed request. */
  readonly resumeCarriesSystem: boolean;
  status(refresh?: boolean): Promise<ProviderStatus>;
  run(req: RunRequest, events: RunEvents): Promise<RunResult>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly hint?: string, readonly authFailure = false) {
    super(message);
  }
}

/** Strip variables that make a child harness think it is nested inside another Claude Code session. */
export function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_AGENT_SDK_VERSION' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT') continue;
    out[k] = v;
  }
  return out;
}
