---
title: Claude Code and Codex hook events, as observed
scope: repo
created: 2026-09-26
trigger: pattern
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - hooks
  - claude-code
  - codex
  - moon-base
---

# Claude Code and Codex hook events, as observed

## Lesson

Both tools call user hooks with JSON on stdin whose `session_id` equals the session's transcript ID: the transcript file's UUID for Claude Code, the rollout file's UUID for Codex. Build live status only on the events actually observed, and make the terminal events synchronous.

Observed with Claude Code 2.1.159: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `StopFailure` (fired on an auth failure, with `error` and `last_assistant_message` in the payload) and `SessionEnd`, both in headless runs and when the desktop app imported a session. Observed with Codex 0.157.1 once its hooks were trusted: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` and `SessionEnd`. Not observed: `PermissionRequest` and `Notification` (Claude Code), `PermissionRequest` and `Interrupt` (Codex).

## Applies When

- Designing or changing the live-status pipeline or the hook installer.
- Choosing which hook events to register.
- Testing hooks without a human at the keyboard.

## Do Instead

- Treat non-interactive runs as unable to reach a permission prompt. A refused tool call fired `PreToolUse` and `Stop` only. Verify the permission events in an interactive session of each tool, and for Claude Code in a desktop-app session, before relying on them.
- Make `Stop`, `StopFailure` and `SessionEnd` hooks synchronous. An asynchronous one was lost once when the process exited right after it. Keep the chatty events asynchronous.
- Budget about 10 ms of Node boot plus about 2 ms of work per event.
- Key everything on the full session ID.

## Evidence

- Observed during the Unit 1 live verification of the Moon Base plan. Results are recorded in `docs/features/moon-base/spec.md` under Spike findings and Still open.
