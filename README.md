# Chorus

A macOS desktop chat that talks to **Claude** (through the Claude Agent SDK / Claude Code harness) and **GPT** (through the Codex SDK / Codex harness) while the app keeps one canonical transcript. Every message can be sent in one of three modes:

```
[ Solo ▾ ]    [ Compare ]    [ Consensus ]
```

- **Solo** — one model answers (pick Claude or ChatGPT from the Solo menu).
- **Compare** — both answer the same packet in parallel, side by side.
- **Consensus** — the models take turns in one shared discussion until both signal agreement or they reach the turn limit. Who starts, the turn limit and the instructions each speaker gets are editable in Settings → Consensus.

Both models always receive the same material: global custom instructions, per-chat instructions, conversation-level reference files (PDF, DOCX, XLSX/CSV, Markdown, code, images), message-scoped attachments and images, and the shared transcript, including the other model's messages.

The model pickers list every model the harnesses offer to your account (Opus 5.5, Sonnet 5, Fable 5.1, GPT-6-Astra and so on), read live from the Claude Agent SDK and the bundled Codex catalog. The right-hand panel shows how much of each plan's 5-hour and weekly allowance is left, and when it resets.

Design notes live in `docs/superpowers/specs/2026-09-14-chorus-design.md`.

## How context is managed

- The app owns the transcript (`~/Library/Application Support/chorus/conversations/*.json`, append-only turns).
- Each provider keeps a harness session (Claude session id / Codex thread id). Warm sessions receive only the turns they have not seen (catch-up), so the harness's own context and native compaction do the long-range work.
- When a session is missing or stale, the app rebuilds a *fresh packet*: instructions + references + latest compaction summary + recent turns verbatim + the current message.
- Budgets are derived from the discovered context window (Claude reports it per result; Codex publishes a model catalog with `context_window`). Nothing is hard-coded.
- If a fresh packet exceeds the budget, older turns are summarised with a fixed compaction prompt that preserves instructions, facts, decisions, referenced files, and unresolved disagreements. The summary is stored in the transcript and shown in the context panel.

## Signing in

Open Settings (⌘,) and press **Sign in** on each provider card. The provider's
own page opens in your browser; approve it there and the app picks the session
up on its own, flipping the card from *Needs sign-in* to *Ready*. Nothing is
typed into Chorus, and the app never sees your password.

- **Claude** uses the desktop OAuth flow (authorization code with PKCE on a
  loopback redirect) and keeps the session in the same place the Claude Code
  CLI does, so the two stay in sync and the session renews itself. If your
  browser runs on another machine, paste the link it landed on into the
  fallback field on the card.
- **GPT** hands off to `codex login`, which does its own exchange.

**Sign out** on a card forgets that provider's session.

## Requirements

- macOS, Node 22 (`nvm use` reads `.nvmrc`)
- A Claude subscription and a ChatGPT account, plus the Codex CLI on your PATH.

## Run

```bash
nvm use && npm install
npm run dev          # development with hot reload
npm run build        # production bundle in out/
npm run dist         # Chorus.app in release/mac-arm64/
npm test             # unit tests (context builder, compaction, stores, attachments, orchestrator)
npm run smoke        # launches the built app under Playwright and screenshots it
npm run smoke:live   # same, plus a real Solo message via Codex and a Compare turn
npm run visual -- <userDataDir> <shotsDir>   # screenshots every surface against a copy of your data
```

Settings → Appearance switches between light, dark and the system theme, and between four accent colours.

Keyboard: ⌘N new conversation · ⌘, settings · ⌃⌘S show or hide the sidebar · Return send · Shift-Return newline. Drop or paste files anywhere in the composer (message-scoped) or the context panel (conversation-scoped).
