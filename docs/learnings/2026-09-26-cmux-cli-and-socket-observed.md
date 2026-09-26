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

## Applies When

- Building or changing anything that starts a workspace in cmux, such as the Moon Base launcher in `server/lib/terminal.mjs`.
- Reporting why a launch failed: exit code 1 with `Access denied` means the caller is not inside cmux.

## Do Instead

- Pass the folder as `--cwd` and keep it out of the `--command` text.
- Check `cmux <command> --help` on the installed version before relying on a flag.
- To test a launcher, run the server from a cmux terminal. A process outside cmux (including a Claude Code session started elsewhere) cannot connect, so it cannot smoke-test the socket.

## Evidence

- Same-day session on the Moon Base terminal hand-off: help output for `cmux` and `cmux new-workspace`, the `Info.plist` URL types, and a `cmux ping` from outside cmux (exit 1, access denied). Not yet confirmed from inside a cmux terminal.
