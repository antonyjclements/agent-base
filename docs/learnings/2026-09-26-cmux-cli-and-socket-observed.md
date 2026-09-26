---
title: cmux is scriptable through a CLI and a socket that only accepts its own child processes
scope: repo
created: 2026-09-26
trigger: pattern
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - cmux
  - terminal
  - moon-base
---

# cmux is scriptable through a CLI and a socket that only accepts its own child processes

## Lesson

Observed on cmux 0.64.25 (macOS), read-only: help output, `cmux docs api`, `cmux ping`, `cmux version`.

- cmux is a Ghostty-based terminal. It registers the URL schemes `http`, `https`, `ssh` and `cmux`, and the `cmux` one is registered under `com.cmuxterm.app.auth`. Nothing documents a URL that opens a workspace, so drive it through the CLI.
- `cmux new-workspace [--name] [--cwd <path>] [--command <text>] [--env KEY=VALUE] [--focus <true|false>] ...` creates a workspace "in the caller's window", with `--command` run as the initial command. `--focus` defaults to false. `cmux <path>` opens a folder in a new workspace.
- The default socket mode refuses any process that was not started inside cmux. From outside, `cmux ping` exits 1 and prints `Access denied - only processes started inside cmux can connect` on stderr. It also prints a note that the default socket is unavailable and it is using `/tmp/cmux-<uid>.sock`.
- The `cmux` binary is in the app bundle (`/Applications/cmux.app/Contents/Resources/bin/cmux`) and was not on the plain shell `PATH`.
- A documentation page fetched through a summarizing tool said `new-workspace` had no working-directory option. The installed CLI's own help showed `--cwd`. For CLI flags, trust `<tool> <command> --help` over a summary of the docs.
- `cmux sessions [list] [--agent <name>] [--session <id>] [--cwd <text>] [--json]` reads saved agent-session records straight from `~/.cmuxterm/*-hook-sessions.json` and its own help says it **"does not require a running cmux socket"** — confirmed: it answers from outside cmux, unlike everything else in this doc. For a session cmux has launched, its JSON includes `session_id`, `pid`, `stored_pid_exists` (whether that pid is still alive), `workspace_id`, `surface_id`, `cwd`, `transcript_path` and the exact `stored_pid_arguments` it launched with.
- Typing a bare `claude` or `codex` inside a cmux terminal does not run the plain command: cmux wraps it with its own `--settings <generated file>` and `--mcp-config={"mcpServers":{"cmux-cua":...}}`, adding its own computer-use MCP server to the session. Observed on a `claude --resume <id>` launched by Moon Base's `cmux new-workspace --command`: the process list showed the wrapped form, but the session id, cwd and transcript were exactly the ones asked for. Harmless to rely on, but a live `ps` listing will not show the plain command back.
- No cmux command was found to focus an existing workspace by id from outside it — `workspace-action`'s action list (pin/unpin, rename, move-\*, close-\*, mark-read/unread, set/clear-color) has nothing for it, `tab-action` only acts on tabs within the caller's own current workspace, and `focus-window` only takes a window, not a workspace.
- `new-workspace --focus true` (and `--focus` on the other commands that take it) selects a workspace or tab *inside* cmux's own window; it does not raise the cmux *application* over whatever else currently has the OS's attention. Confirmed the hard way: a real `--focus true` launch left cmux behind the browser. `open -a cmux` (macOS's ordinary "bring this app forward" primitive, the same one used for `claude://`/`codex://` links) does the second part; it resolves cmux by its bundle id (`com.cmuxterm.app`) and runs without error, though whether it visibly raises the window every time is not yet confirmed by eye.

## Applies When

- Building or changing anything that starts a workspace in cmux, such as the Moon Base launcher in `server/lib/terminal.mjs`.
- Reporting why a launch failed: exit code 1 with `Access denied` means the caller is not inside cmux.
- Deciding whether a session is already open before launching another one on it: `cmux sessions` is the read that works without the socket dance.

## Do Instead

- Pass the folder as `--cwd` and keep it out of the `--command` text.
- Check `cmux <command> --help` on the installed version before relying on a flag.
- To test a launcher, run the server from a cmux terminal. A process outside cmux (including a Claude Code session started elsewhere) cannot connect, so it cannot smoke-test the socket.
- Before starting a second `claude --resume <id>` or `codex resume <id>`, check `cmux sessions --agent <agent> --session <id> --json` for `stored_pid_exists: true`. Two of those on the same id race the one transcript file both processes write.
- Do not rely on `--focus true` to bring cmux forward for the person watching. Pair it with `open -a cmux` (or an equivalent OS-level activation) whenever the point of the action is for them to actually see the result.

## Evidence

- Same-day session on the Moon Base terminal hand-off: help output for `cmux` and `cmux new-workspace`, the `Info.plist` URL types, and a `cmux ping` from outside cmux (exit 1, access denied).
- Confirmed from inside a cmux terminal the same day (M6): a `cmux new-workspace --command` launch produced a live `claude --resume <id>` process in the right folder with the right transcript, wrapped in cmux's own `--settings`/`--mcp-config` flags; `cmux sessions --agent claude --session <id> --json` (run from outside cmux, no socket) correctly reported it as open with the real pid and workspace id. That same run is what surfaced the duplicate-launch bug fixed by the already-open check.
