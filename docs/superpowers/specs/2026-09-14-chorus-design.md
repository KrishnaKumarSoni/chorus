# Chorus — design spec

Date: 2026-09-14. Status: approved for implementation under the assumptions listed in §0.

Chorus is a macOS desktop chat app that talks to two AI providers through their
own harnesses (OpenAI Codex via `@openai/codex-sdk`, Anthropic Claude via
`@anthropic-ai/claude-agent-sdk`) while the app owns the canonical transcript,
custom instructions, and reference files. Every message can be sent in one of
three modes: **Solo**, **Compare**, **Consensus**.

## 0. Assumptions and constraints (decided, not asked)

| Decision | Choice | Why |
|---|---|---|
| Shell | Electron 44 + Vite + React 18 + TypeScript | Xcode is not installed on this machine (only Command Line Tools) and Rust is absent, so native SwiftUI or Tauri cannot be built or verified here. Both harness SDKs are Node packages, so Electron's main process hosts them directly. |
| Harnesses | Claude Agent SDK (bundles the Claude Code CLI) and Codex SDK (bundles the codex binary) | Requirement 6: reuse the harness machinery (sessions, native compaction, tools) instead of raw API calls. |
| Auth | Reuse existing logins: Claude Code OAuth (`~/.claude`), Codex ChatGPT tokens (`~/.codex/auth.json`) | No key entry in the app. The app never handles credentials. |
| Persistence | One JSON file per conversation under Electron `userData/conversations/`, attachments under `userData/attachments/` | "One canonical local transcript" that is human-readable; no native SQLite build step. |
| Default models | Claude: `claude-opus-5` (Agent SDK default alias may resolve differently; user can change); Codex: the model in `~/.codex/config.toml` (`gpt-5.5`) | Discovered at runtime, overridable in Settings. |
| Retrieval | No RAG. Reference text goes into context whole, capped by budget with an explicit truncation note | Requirement: MVP architecture without sophisticated retrieval. |
| Name | Chorus | Multiple voices, one transcript. |

## 1. Architecture

```
            Renderer (React)                    Main process (Node)
 ┌──────────────────────────────┐   IPC   ┌─────────────────────────────────────┐
 │ Sidebar · Thread · Composer  │◀──────▶│ ConversationStore (JSON on disk)     │
 │ Context panel · Settings     │ events  │ AttachmentService (copy + extract)   │
 └──────────────────────────────┘         │ ContextBuilder (pure)                │
                                          │ Compactor (pure + one model call)    │
                                          │ Orchestrator: solo/compare/consensus │
                                          │   ├─ ClaudeAdapter → Agent SDK → CLI │
                                          │   └─ CodexAdapter  → Codex SDK → bin │
                                          │ Capabilities (models, ctx windows)   │
                                          └─────────────────────────────────────┘
```

The renderer never touches the SDKs. The preload exposes a typed `window.chorus`
API (invoke + event subscription). All state of record lives in main.

## 2. Data model

```ts
type Provider = 'claude' | 'codex';
type Mode = 'solo' | 'compare' | 'consensus';

interface Settings {
  globalInstructions: string;
  defaultMode: Mode;
  solo: { provider: Provider };
  models: Record<Provider, string>;          // chosen model id per provider
  effort: Record<Provider, string>;          // 'low'|'medium'|'high'|'xhigh'|'max'
  consensusChair: Provider;                  // who writes the final synthesis
}

interface Attachment {
  id: string; name: string; mime: string; size: number;
  storedPath: string;                        // copy inside userData/attachments
  kind: 'image' | 'text' | 'pdf' | 'docx' | 'sheet' | 'binary';
  textPath?: string;                         // extracted text sidecar
  textChars?: number;
  extractError?: string;
}

interface Turn {
  id: string; index: number;                 // index is position in transcript
  role: 'user' | 'assistant';
  exchangeId: string;                        // groups a user turn with its replies
  mode: Mode;
  text: string;
  createdAt: string;
  attachments?: Attachment[];                // user turns only (message-scoped)
  author?: { provider: Provider; model: string };   // assistant turns
  round?: number; kind?: 'answer' | 'critique' | 'synthesis';
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  error?: string;
  usage?: { input: number; output: number; cachedInput?: number };
}

interface Compaction {
  id: string; throughTurnIndex: number;      // summarises turns [0..throughTurnIndex]
  summary: string; createdAt: string;
  by: { provider: Provider; model: string };
  tokensBefore: number; tokensAfter: number;
}

interface HarnessSession {
  id: string;                                // Claude session_id / Codex thread_id
  model: string;
  syncedThroughTurnIndex: number;            // last transcript turn this session has seen
  referenceIds: string[];                    // conversation references it has seen
  stale?: boolean;                           // forces a fresh packet next time
}

interface Conversation {
  id: string; title: string; createdAt: string; updatedAt: string;
  instructions: string;                      // per-chat instructions
  references: Attachment[];                  // conversation-level context files
  turns: Turn[];
  compactions: Compaction[];
  sessions: Partial<Record<Provider, HarnessSession>>;
  mode: Mode;                                // last used mode
}
```

Invariant: `turns` is append-only and ordered by `index`. Assistant turns from
both providers live in the same list; that is what makes Compare and Consensus
share one transcript.

## 3. Context building (the heart)

`ContextBuilder.build(conv, target, caps, session?) → Packet` is a pure
function.

Inputs: the conversation, the target `{provider, model}`, discovered
capabilities `{contextWindow, maxOutputTokens?}`, and the harness session for
that provider (if any).

Budget: `budget = floor(contextWindow * 0.80) − outputReserve`, where
`outputReserve = min(maxOutputTokens ?? 16000, 32000)`. Nothing hard-codes a
window; `contextWindow` is discovered (§6).

Token estimation: `ceil(chars / 4)` for text; `1600` per image. Actual usage
returned by the harness after each turn is stored and used to re-calibrate
(ratio of actual/estimated, clamped 0.5–2.0, kept in capability cache).

Two packet shapes:

**Resume packet** (session exists, not stale, model unchanged):
```
[catch-up]   turns with index > session.syncedThroughTurnIndex, excluding the
             current user turn, rendered as a labelled transcript
             ("### User", "### Claude (claude-opus-5)", "### GPT-5.5 (codex)")
[new refs]   conversation references added since (extracted text / images)
[current]    the user's new message text + its message-scoped attachments
```
Sent via `resume` (Claude) / `resumeThread` (Codex), so the harness's own
context and native compaction do the long-term work.

**Fresh packet** (no session, session stale, resume failed, or resume packet
would not fit):
```
system     = app persona + global instructions + per-chat instructions
user turn  = <references>   all conversation references (text extracted; images native)
             <history>      latest Compaction.summary (if any)
                            + turns after it, verbatim, labelled by author
             <message>      current message + attachments
```
Compaction runs first if the fresh packet exceeds the budget (§4). The system
prompt is identical in shape for both providers; only the transport differs.

Reference budget: references may use at most 35% of the budget. If they exceed
it, each file is truncated proportionally with a visible
`[... truncated: N of M characters shown ...]` marker, and the UI shows a
warning badge on the reference.

After a successful turn the adapter records `syncedThroughTurnIndex = index of
the assistant turn it just produced` and the reference ids it saw. Because the
other provider's reply is appended later with a higher index, it is delivered
as catch-up on this provider's next turn. Removing a reference marks every
session stale.

## 4. Compaction (app-level)

Trigger: only when building a fresh packet whose estimate exceeds the budget.
(Warm sessions rely on the harness's native compaction; Claude reports it via
`compact_boundary`, which the app logs to the turn's activity list.)

Algorithm:
1. Keep verbatim the most recent turns until they fill 50% of the budget, but
   never fewer than the last 3 exchanges.
2. Everything older (plus any existing compaction summary) is summarised by the
   target provider using a fixed compaction prompt that must preserve, in
   labelled sections: user instructions given in-chat; facts and numbers;
   decisions made; references and attachments mentioned (by name); open
   questions and unresolved disagreements between the models; the user's
   current goal.
3. Store the result as a `Compaction` with `throughTurnIndex`. Older
   compactions are kept for audit but only the latest is sent.

Compaction is a normal adapter call with `tools: []`, low effort, a separate
throwaway harness session, and no streaming to the UI beyond a status line.

## 5. Modes (Orchestrator)

All modes append the user turn first (with attachments), then:

- **Solo**: one adapter call. One assistant turn.
- **Compare**: both adapters in parallel with their own packets. Two assistant
  turns in the same exchange, rendered side by side. Failure of one does not
  cancel the other.
- **Consensus** (two rounds + synthesis, all in the shared transcript):
  1. Round 1 — both answer in parallel (`kind: 'answer'`).
  2. Round 2 — each provider receives the other's round-1 answer through the
     normal catch-up path plus a critique instruction: assess the other answer,
     revise your own, list explicit agreements and disagreements
     (`kind: 'critique'`).
  3. Synthesis — the chair provider writes the consensus: the agreed answer,
     then an "Unresolved" section listing any remaining disagreement with each
     side's position (`kind: 'synthesis'`). If the chair fails, the other
     provider is tried.
  Round instructions are sent as part of the user-side packet (not stored as
  user turns); the stored turns carry `round`/`kind` so the UI can group them.

Cancel: aborts every in-flight call of the exchange; partial text is kept with
`status: 'cancelled'`.

## 6. Provider adapters and capability discovery

Common interface:
```ts
interface Adapter {
  listModels(): Promise<ModelDescriptor[]>;                   // id, label, contextWindow?, efforts
  run(req: RunRequest, on: RunEvents): Promise<RunResult>;     // streaming
}
RunRequest = { conversationId, model, effort, system, packet: Packet, session?: HarnessSession, signal }
RunEvents  = { onDelta(text), onActivity(label), onSession(id) }
RunResult  = { text, sessionId, usage, contextWindow?, compacted?: boolean }
```

**ClaudeAdapter** — `query({ prompt: AsyncIterable<SDKUserMessage>, options })`
with `systemPrompt: {type:'custom', prompt}`, `model`, `effort`,
`tools: []` (chat app, no filesystem tools), `permissionMode: 'dontAsk'`,
`includePartialMessages: true`, `resume` when a session exists, `maxTurns: 1`.
Images are `image` content blocks (base64). Text deltas come from
`stream_event` → `content_block_delta.text_delta`. The `result` message gives
`session_id` and `modelUsage[model].contextWindow` / `maxOutputTokens`, which
are written to the capability cache — this is the runtime source of truth for
the Claude context window. Models: `query.supportedModels()` once per launch.

**CodexAdapter** — `new Codex()`; `startThread` / `resumeThread(id)` with
`{ model, modelReasoningEffort, sandboxMode: 'read-only', skipGitRepoCheck:
true, workingDirectory: <per-conversation scratch dir>, webSearchMode: 'disabled'
}`. Input is `UserInput[]` with `text` and `local_image` items. Deltas: from
`item.updated`/`item.completed` for `agent_message`. Usage from
`turn.completed`. Models and context windows: `$CODEX_HOME/models_cache.json`
(`slug`, `display_name`, `context_window`, `supported_reasoning_levels`,
`visibility === 'list'`), falling back to the configured model in
`config.toml` with a conservative window if the cache is absent.

Capability cache (`userData/capabilities.json`): per provider+model
`{contextWindow, maxOutputTokens?, calibration}`; updated after every turn.

## 7. Attachments

`AttachmentService.ingest(source: {path} | {buffer, name, mime})`:
copies the file into `userData/attachments/<id>/<name>`, classifies it, and
extracts text into a sidecar:
- pdf → `pdf-parse`; docx → `mammoth`; xlsx/xls/csv → `xlsx` (each sheet as
  CSV); text/markdown/code/json → raw; image → no extraction (native vision).
Extraction failures are recorded, not fatal. Message attachments and
conversation references use the same ingest path, so both providers always
receive identical material.

## 8. UI

Single window, three columns: conversation list; thread; context panel
(references, per-chat instructions, session/compaction status). The composer
has the mode control `[Solo ▾] [Compare] [Consensus]`, attachment chips, and
accepts drag-drop, paste (images and files), and a file picker. Compare and
Consensus exchanges render as side-by-side cards; Consensus adds a round strip
and a final synthesis card with an "Unresolved" callout. Settings sheet: global
instructions, model + effort per provider, consensus chair, default mode.
Visual/interaction direction is provided by the fluid-design, apple-design,
design-taste-frontend and better-ui skills during implementation.

## 9. Error handling

- Adapter failure on resume → clear that provider's session, retry once with a
  fresh packet. Second failure → assistant turn `status: 'error'` with message.
- Compaction failure → send the fresh packet with the oldest turns dropped and
  a visible warning; never silently truncate without telling the user.
- Attachment extraction failure → attachment kept, badge shown, text omitted.
- All IPC handlers return `{ok, error}`; the renderer shows a toast.

## 10. Testing

- Unit (vitest): token estimation and calibration; ContextBuilder for resume
  vs fresh, reference budgeting, catch-up selection, stale sessions; compaction
  turn selection; ConversationStore round-trip; attachment extraction on small
  fixtures (txt, md, csv, xlsx, docx, pdf); consensus orchestration with fake
  adapters (ordering, rounds, chair fallback, cancellation).
- Integration: the two SDK probes (`scripts/probe-*.mjs`) prove auth and
  streaming against the real harnesses.
- End-to-end smoke: launch the Electron app under Playwright, create a
  conversation, send a Solo message, and screenshot.

## 11. Out of scope for this iteration

RAG/retrieval over references, provider-native file uploads, more than two
providers, multi-window, sync/cloud, auto-updates, code signing.
