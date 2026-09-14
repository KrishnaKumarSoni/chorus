# Chorus implementation plan

Spec: docs/superpowers/specs/2026-09-14-chorus-design.md

Phases (each ends with `npm test` green; phase 6 with a Playwright smoke run):

1. Scaffold: electron-vite (main/preload/renderer), tsconfig, vitest, scripts.
2. Shared types + pure context modules (TDD): tokens, render, builder, compaction selection.
3. Stores: ConversationStore (JSON per conversation, append-only turns), SettingsStore, CapabilityCache.
4. Attachments: ingest + extractors (txt/md/code, csv/xlsx, docx, pdf, image) with fixtures.
5. Providers: Adapter interface, ClaudeAdapter (Agent SDK), CodexAdapter (Codex SDK), model discovery. Orchestrator for solo/compare/consensus with fake adapters under test.
6. Electron main + preload IPC; React renderer (sidebar, thread, composer with mode switch, context panel, settings); UI skills applied; Playwright smoke test; package with electron-builder (--dir).
