---
title: Read matched cmux panes only by opt-in to detect waiting without hooks
date: 2026-09-26
status: active
tags:
  - cmux
  - live-status
  - privacy
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# Read matched cmux panes only by opt-in to detect waiting without hooks

## Context

The user runs Claude Code only in cmux terminals at work and cannot use hooks. cmux's integration is disabled, so its event stream does not provide the expected waiting signals. Investigation reproduced unanswered question/plan tool calls shown as working, newer completed replies overridden by old busy markers, and file-only sessions polling every fifteen seconds. The user confirmed that `cmux read-screen` prints their Claude session and requested all three improvements.

## Decision

Poll live terminal sessions every three seconds, and compare timestamped transcript evidence with live markers and events. Unanswered interactive calls wait until their matching result or a new human prompt.

For ordinary permission prompts, opt in with `MOON_BASE_CMUX_SCREEN=on`. Read the cmux process tree and match Claude's own live PID to exactly one surface. Read only that surface's visible viewport with explicit UUIDs. Never match by repo name, cwd or title. Never focus, type, approve, read process environments or install hooks. Keep subprocess execution in the existing terminal helper, with fixed commands, validated arguments, timeouts and output limits.

Screen detection retains only a waiting reason and sample time; it drops raw terminal text and process details. Unknown layouts, ambiguous mappings and failed commands add no evidence. Sampling is bounded to sixteen panes per scan with rotation for larger sets. This supplements the socket-free AC14 event stream; its opt-in socket reads are the explicit AC16 exception to that earlier scope.

## Consequences

- Works with existing sessions without a launch wrapper or cmux's hook registry when process diagnostics and socket access are available.
- Reading terminal text is a broader input than event metadata, hence the separate opt-in. Nothing is sent externally or exposed in the API.
- Prompt recognition depends on English Claude dialog controls and can miss changed layouts. Quiet output is never classified as waiting.
- Upstream CLI source shows `read-screen` calls `surface.read_text` without a focus action and uses the same `system.top` process tree for PID binding. cmux refuses socket access from this implementation environment because it is outside cmux's process tree; background focus behavior and real work-machine prompts remain manual check M12.

## Alternatives Considered

- Hooks: unavailable at work.
- Busy/idle markers alone: cannot reliably distinguish an executing tool from one waiting for approval.
- Treating silence as waiting: misclassifies long-running work.
- Matching cwd/title or reading every terminal: risks associating another session's prompt and broadens reading unnecessarily.
- Manual pane binding: unnecessary while exact PID matching is available; unsupported environments fall back honestly.

## Links

- `docs/features/moon-base/spec.md` (AC16)
- `docs/features/moon-base/plan.md` (Units 18–20, M12)
- [cmux CLI implementation](https://github.com/manaflow-ai/cmux/blob/main/CLI/cmux.swift)
- `docs/decisions/2026-09-26-live-status-from-cmux-event-stream-metadata-only.md`
