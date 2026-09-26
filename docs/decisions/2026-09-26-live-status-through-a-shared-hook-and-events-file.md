---
title: Live status comes from one shared hook that appends to a private events file
date: 2026-09-26
status: active
tags:
  - hooks
  - architecture
  - security
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# Live status comes from one shared hook that appends to a private events file

## Context

Inferring status from session files lags and cannot see "waiting on a permission". Claude Code and Codex both run user hooks with JSON on stdin, but Codex has no HTTP hook type, and a hook runs inside the tool, so it must never print, block or leak.

## Decision

One small hook script, run through a fixed `sh` wrapper, appends a bounded line naming the tool, the event and the session to `~/.moon-base/events/events.jsonl` (mode 0700 and 0600, refused if others can write). It records no prompt, tool call or reply. The server reads it on each scan and lays the result over what the adapters found, but only for sessions it already knows: an event for an unknown session is held for a minute and then dropped, so events can colour a bot and can never create one or trigger an action. Every state expires, so a tool that stops reporting falls back to its files. The terminal events (`Stop`, `StopFailure`, `SessionEnd`) run in the foreground; the rest run in the background. Only the events the map needs are registered, because Codex prints two visible lines per hook per event. While hooks are reporting, the page polls every 3 seconds instead of 15.

## Consequences

- Any process running as the same user can forge display state. That is the same trust boundary as the session files themselves, and is documented.
- `PermissionRequest` and `Notification` (Claude Code) and `PermissionRequest` (Codex) were not observed in this work and remain to be verified in interactive and desktop sessions; where a tool does not signal them, "awaiting input" stays inferred from files.

## Alternatives Considered

- An HTTP hook for Claude Code: inconsistent across the two tools and noisy when the app is closed.
- Watching files only: the status quo, kept as the fallback.

## Links

- `docs/features/moon-base/spec.md` (AC6, AC7), `docs/learnings/2026-09-26-hook-events-claude-code-and-codex.md`
