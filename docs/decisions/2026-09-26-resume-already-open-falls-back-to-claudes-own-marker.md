---
title: Resume's already-open check falls back to Claude's own marker when cmux's record is empty
date: 2026-09-26
status: active
tags:
  - cmux
  - terminal
  - resume
  - hooks
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# Resume's already-open check falls back to Claude's own marker when cmux's record is empty

## Context

Before Resume starts a second `claude --resume <id>`, Moon Base asks `cmux sessions` whether that session is already open, because two processes on one session race the one transcript file. `cmux sessions` reads only `~/.cmuxterm/claude-hook-sessions.json`, which cmux's Claude hooks write, and those hooks are injected by cmux's wrapper only while its Claude Code integration (`claudeCodeIntegration`, or `CMUX_CLAUDE_HOOKS_DISABLED`) is on. At work that integration is off, so cmux's record was empty and every Resume opened a second workspace. The same switch is why the cmux stream (AC14) was "not found" there.

Claude writes its own marker for every live process, `~/.claude/sessions/<pid>.json`, with the session id and an `entrypoint`. Moon Base already reads and pid-probes it for live status.

## Decision

The launch route asks two checks together and either answering "running" holds the launch back: cmux's record, and, through an optional adapter method `sessionRunning(id)`, the tool's own record. Only Claude Code has one. A marker counts when its pid is alive, its session id is the one being resumed, and its `entrypoint` is not `claude-desktop`. The answer stays `{ ok: true, already: true }` for cmux and gains `via: 'claude'` only when the marker answered; the page then says "Already running" and names no terminal, because the marker cannot say which holds the session. Any error, or any answer but exactly `true`, reads as not running.

The doctor gets a Resume check row (through a count-only `cmuxSessionsSummary`), says the stream is missing because cmux's Claude Code integration is off rather than asking whether cmux is installed, and counts the live terminal sessions among the markers.

## Consequences

- Resume holds back a duplicate on a machine with no hooks and cmux's integration off, which was the reported failure. It also holds one back for a session started outside cmux, which is the same race.
- A desktop-app process does not count, so a thread the desktop app is keeping warm can still be resumed in a terminal, as before. The exclusion is a denylist: another host that pre-warms idle sessions would wrongly hold Resume back until it is added.
- A stale marker whose pid was reused by an unrelated process of the same user would hold Resume back. Copy mode still works. Closing this needs a process-start check, which needs a new process-spawning site (the security test allows exactly three files), and the marker's `procStart` is UTC while `ps` prints local time.
- Codex has no such marker, so Codex resume keeps depending on cmux's record.
- The response gains a field only in the new case, so the existing cmux answer, and every test that pins it, is unchanged.

## Alternatives Considered

- **Turn cmux's integration on.** Fixes it fully, but it injects Claude hooks through `--settings`, which is what a locked-down work machine may not allow. Offered to the person as their choice; not something Moon Base can rely on.
- **Match cmux surfaces by process or title.** Fragile, and cmux exposes no stable way to ask which surface runs which session without its hooks.
- **Count every marker, desktop app included.** Simpler, but it would stop terminal Resume for every thread the desktop app has warmed, a regression where both are used.
- **Verify the pid's start time.** Correct, but see Consequences.

## Links

- `docs/features/moon-base/spec.md` (AC13, AC15 doctor)
- `docs/features/moon-base/plan.md` (D25 to D27, Unit 16)
- `docs/learnings/2026-09-26-cmux-records-depend-on-its-claude-code-integration.md`
