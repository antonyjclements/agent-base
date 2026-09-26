---
title: Sessions open through URL schemes only, and the server starts no other process
date: 2026-09-26
status: superseded
tags:
  - security
  - server
  - controls
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# Sessions open through URL schemes only, and the server starts no other process

## Context

Clicking a bot has to open or start a session in Claude Code or Codex. Upstream could also run each tool's CLI in a terminal and focus a window by process id, so its server built command lines and could start several kinds of process from request data.

## Decision

The only thing the server ever starts is the OS opener, with a `claude://` or `codex://` URL as a single argument and no shell. A thread is named by its id and looked up in the server's own scan, so the tool's `ref` never comes from the request. A new session may only start in a folder that a known thread already lives in. Only those two schemes are allowed. The Reveal-in-Finder route, the terminal setting, the CLI fallback commands and the Windows window-focus helper are removed. A Claude Code session that exists only in the terminal is opened by importing it, so the page asks first.

## Consequences

- The server has no path from a request to a command, which tests enforce, including a scan that only the opener and the Linux scheme probe may use `child_process`.
- Sessions that a tool's URL scheme cannot open are shown as not openable; terminal resume is a non-goal.
- The URL shapes were observed on this machine, not documented, so they are built in one place per adapter and covered by tests that need updating if the apps change.

## Alternatives Considered

- Terminal launch (`claude --resume`, `codex resume`): broader coverage but a command path to validate and confirm; deferred to its own spec.
- Focusing an existing window by process id: rejected as a second kind of subprocess.

## Links

- `docs/features/moon-base/spec.md` (AC8), `docs/learnings/2026-09-26-claude-and-codex-url-schemes-observed.md`
