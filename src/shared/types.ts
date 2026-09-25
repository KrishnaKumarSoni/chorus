export type Provider = 'claude' | 'codex';
export type Mode = 'solo' | 'compare' | 'consensus';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Appearance = 'system' | 'light' | 'dark';
export type Accent = 'jade' | 'iris' | 'rose' | 'graphite';

/** Instructions given to each model in a consensus run. `{other}` becomes the other model's name. */
export interface DebatePrompts {
  opening: string;
  reply: string;
}

export interface Settings {
  globalInstructions: string;
  defaultMode: Mode;
  soloProvider: Provider;
  models: Record<Provider, string>;
  effort: Record<Provider, Effort>;
  /** Who speaks first in a consensus run. */
  consensusStarter: Provider;
  /** Hard cap on model turns in a consensus run. */
  consensusMaxTurns: number;
  debatePrompts: DebatePrompts;
  appearance: Appearance;
  accent: Accent;
  sidebarCollapsed: boolean;
  /** Let both models search and read the web when a question needs current or outside facts. */
  webAccess: boolean;
}

export type AttachmentKind = 'image' | 'text' | 'pdf' | 'docx' | 'sheet' | 'binary';

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  storedPath: string;
  kind: AttachmentKind;
  textPath?: string;
  textChars?: number;
  extractError?: string;
  /** Transcript index of the last turn that existed when this reference was added (conversation references only). */
  addedAfterTurnIndex?: number;
}

export type TurnStatus = 'streaming' | 'done' | 'error' | 'cancelled';
export type TurnKind = 'answer' | 'critique' | 'synthesis';

export interface Author {
  provider: Provider;
  model: string;
}

export interface Usage {
  input: number;
  output: number;
  cachedInput?: number;
}

export interface Turn {
  id: string;
  index: number;
  role: 'user' | 'assistant';
  exchangeId: string;
  mode: Mode;
  text: string;
  createdAt: string;
  attachments?: Attachment[];
  author?: Author;
  round?: number;
  kind?: TurnKind;
  /** Consensus only: this model signalled it had nothing substantive left to add. */
  agreed?: boolean;
  status: TurnStatus;
  error?: string;
  usage?: Usage;
  activity?: string[];
}

export interface Compaction {
  id: string;
  throughTurnIndex: number;
  summary: string;
  createdAt: string;
  by: Author;
  tokensBefore: number;
  tokensAfter: number;
}

export interface HarnessSession {
  id: string;
  model: string;
  /** Highest transcript index this session has been shown (informational). */
  syncedThroughTurnIndex: number;
  /** Ids of every transcript turn this session has seen, including its own replies. */
  seenTurnIds: string[];
  referenceIds: string[];
  /** Hash of the system prompt the session was created with (matters for transports that bake it in). */
  systemHash?: string;
  stale?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  instructions: string;
  references: Attachment[];
  turns: Turn[];
  compactions: Compaction[];
  sessions: Partial<Record<Provider, HarnessSession>>;
  mode: Mode;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  mode: Mode;
  turnCount: number;
}

export interface ModelDescriptor {
  provider: Provider;
  id: string;
  label: string;
  /** One line from the provider, e.g. what the model is good at. */
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  efforts?: Effort[];
  isDefault?: boolean;
}

export interface Capability {
  contextWindow: number;
  maxOutputTokens?: number;
  /** actual/estimated token ratio learned from real usage, clamped to [0.5, 2]. */
  calibration: number;
  source: 'discovered' | 'catalog' | 'fallback';
}

export interface ProviderStatus {
  provider: Provider;
  ok: boolean;
  detail: string;
  models: ModelDescriptor[];
}

/** One plan usage window, e.g. the 5-hour session or the weekly allowance. */
export interface LimitWindow {
  label: string;
  /** Share of the window already used, 0-100. */
  usedPercent: number;
  resetsAt?: string;
  severity?: 'normal' | 'warning' | 'critical';
}

export interface ProviderLimits {
  provider: Provider;
  plan?: string;
  windows: LimitWindow[];
  /** Why no windows are shown (API key, not signed in, fetch failed). */
  note?: string;
  checkedAt: string;
}

/** Events streamed from main to renderer while an exchange runs. */
export type TurnEvent =
  | { type: 'turn-start'; conversationId: string; turn: Turn }
  | { type: 'turn-delta'; conversationId: string; turnId: string; text: string }
  | { type: 'turn-activity'; conversationId: string; turnId: string; label: string }
  | { type: 'turn-done'; conversationId: string; turn: Turn }
  | { type: 'exchange-done'; conversationId: string; exchangeId: string }
  | { type: 'conversation-updated'; conversationId: string };

/** Progress of an in-app provider sign-in, streamed from main to renderer. */
export type AuthEvent =
  | { provider: Provider; phase: 'awaiting-browser'; url: string }
  | { provider: Provider; phase: 'exchanging' }
  | { provider: Provider; phase: 'done' }
  | { provider: Provider; phase: 'error'; message: string }
  | { provider: Provider; phase: 'cancelled' };

export interface SendRequest {
  conversationId: string;
  text: string;
  mode: Mode;
  attachmentIds: string[];
}

export interface IngestSource {
  name: string;
  /** Absolute path on disk (file picker / drop) — or base64 data (paste). */
  path?: string;
  dataBase64?: string;
  mime?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
