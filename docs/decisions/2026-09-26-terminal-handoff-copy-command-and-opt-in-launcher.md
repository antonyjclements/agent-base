---
title: "Terminal hand-off: a copied command, and an opt-in cmux launcher"
date: 2026-09-26
status: active
tags:
  - security
  - server
  - controls
  - terminal
related_specs:
  - docs/features/moon-base/spec.md
supersedes:
  - docs/decisions/2026-09-26-open-sessions-through-url-schemes-only.md
---

# Terminal hand-off: a copied command, and an opt-in cmux launcher

## Context

The earlier decision ([sessions open through URL schemes only](2026-09-26-open-sessions-through-url-schemes-only.md)) removed upstream's terminal launching so the server would have no path from a request to a command, and made terminal resume a non-goal. That left Moon Base with nothing to do on a machine without the Claude and Codex desktop apps, where sessions run in a terminal. The user works that way at work, in cmux.

cmux (0.64.25) is a terminal, not a URL-scheme handler. Its CLI can create a workspace in a folder with an initial command (`cmux new-workspace --cwd <path> --command <text>`), and its socket refuses any process that was not started inside cmux. Both were observed on the machine (see the spec's spike findings).

## Decision

Keep URL schemes as the default and add a `Open sessions with` setting with two more modes, both behind the same rules as before: the thread or folder comes from the server's own scan, and nothing that names a command, argument, folder outside the scan, or launcher is ever read from a request.

1. **Copy terminal command.** The server returns one POSIX shell line for a known thread or repo (`cd '<folder>' && claude --resume <id>`, `codex resume <id>`, or the bare tool). The page copies it. The server starts nothing.
2. **Terminal launcher (cmux).** Available only when whoever starts the server sets `MOON_BASE_TERMINAL=cmux`. The server runs `cmux new-workspace --cwd <folder> --command <line> --focus true` as an argument list, once, with no shell.

The command line is built from tokens each adapter supplies (`claude`, `--resume`, a pattern-checked UUID), and every token must match `[A-Za-z0-9._-]`, so it can carry no shell syntax. The folder is quoted for the pasted line and passed as its own argument to the launcher, and a folder with a control character is refused. The shared code lives in `server/lib/terminal.mjs`, the only new place that starts a process. Adapters describe a command as data (`{ argv, cwd }`) and never run it.

The launcher is chosen from the server's environment on purpose. A request, or a page that got past the Host and Origin checks, cannot turn it on or pick a different program.

## Consequences

- The server now starts one more kind of process, and only when enabled. The test that scanned for `child_process` imports lists `server/lib/terminal.mjs` alongside the opener and the Linux probe, and asserts that it uses `execFile` and never a shell.
- The cmux socket's own rule (only processes started inside cmux) means Moon Base has to be started from a cmux terminal for the launcher to work. A refusal is reported to the page as a fixed message, never as cmux's raw output.
- Copy mode also fixes the CLI-only Claude Code case: resuming in a terminal does not import a second, untitled session into the desktop app, so the import warning does not apply.
- The pasted line is POSIX shell, so this is macOS and Linux only. Windows shells are out of scope.
- Adapters gain two optional methods (`terminalOpen`, `terminalNew`). A harness without them reports that it has no terminal command.
- Not yet verified against a live cmux: whether it is on `PATH` there, and whether `--command` needs the `cd` at all (listed in the spec's Still open).

## Alternatives Considered

- **Restore upstream's terminal launcher as it was.** Rejected: it built command lines from request data and started several kinds of process. Nothing was carried over from it.
- **Only the copy button.** It is the smallest change and needs no launcher, but it costs a paste per session. The launcher is opt-in and small enough to keep, so both ship.
- **Type the command into an existing cmux surface (`cmux send`).** Rejected: it injects keystrokes into a live shell whose state is unknown. `new-workspace --cwd --command` starts a fresh one.
- **Let the page pick the terminal or command.** Rejected outright: that is the arbitrary-command path AC8 exists to prevent.
- **A `cmux://` link.** cmux registers that scheme for sign-in; nothing documents it as a way to open a workspace, so it was not used.

## Links

- `docs/features/moon-base/spec.md` (AC8, AC13)
- `docs/decisions/2026-09-26-open-sessions-through-url-schemes-only.md` (superseded)
- `docs/learnings/2026-09-26-cmux-cli-and-socket-observed.md`
