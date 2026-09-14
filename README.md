# Chorus

A macOS desktop chat that talks to **Claude** (through the Claude Agent SDK / Claude Code harness) and **GPT** (through the Codex SDK / Codex harness) while the app keeps one canonical transcript. Every message can be sent in one of three modes:

```
[ Solo ▾ ]    [ Compare ]    [ Consensus ]
```

- **Solo** — one model answers (pick Claude or GPT from the Solo menu).
- **Compare** — both answer the same packet in parallel, side by side.
- **Consensus** — both answer, each critiques the other, then a chair model writes the agreed reply with an explicit *Unresolved* section.

Both models always receive the same material: global custom instructions, per-chat instructions, conversation-level reference files (PDF, DOCX, XLSX/CSV, Markdown, code, images), message-scoped attachments and images, and the shared transcript, including the other model's messages.

Design notes live in `docs/superpowers/specs/2026-09-14-chorus-design.md`.

## How context is managed

- The app owns the transcript (`~/Library/Application Support/chorus/conversations/*.json`, append-only turns).
- Each provider keeps a harness session (Claude session id / Codex thread id). Warm sessions receive only the turns they have not seen (catch-up), so the harness's own context and native compaction do the long-range work.
- When a session is missing or stale, the app rebuilds a *fresh packet*: instructions + references + latest compaction summary + recent turns verbatim + the current message.
- Budgets are derived from the discovered context window (Claude reports it per result; Codex publishes a model catalog with `context_window`). Nothing is hard-coded.
- If a fresh packet exceeds the budget, older turns are summarised with a fixed compaction prompt that preserves instructions, facts, decisions, referenced files, and unresolved disagreements. The summary is stored in the transcript and shown in the context panel.

## Requirements

- macOS, Node 22 (`nvm use` reads `.nvmrc`)
- Signed in to the Claude Code CLI (`claude login`) and Codex CLI (`codex login`). Chorus never handles credentials itself.

## Run

```bash
nvm use && npm install
npm run dev          # development with hot reload
npm run build        # production bundle in out/
npm run dist         # Chorus.app in release/mac-arm64/
npm test             # unit tests (context builder, compaction, stores, attachments, orchestrator)
npm run smoke        # launches the built app under Playwright and screenshots it
npm run smoke:live   # same, plus a real Solo message via Codex and a Compare turn
```

Keyboard: ⌘N new conversation · ⌘, settings · Enter send · Shift-Enter newline. Drop or paste files anywhere in the composer (message-scoped) or the context panel (conversation-scoped).
