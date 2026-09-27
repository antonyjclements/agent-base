---
title: moonbase1 is one command that starts the server in-process and finds a running copy by asking it
date: 2026-09-26
status: active
tags:
  - cli
  - server
  - cmux
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# moonbase1 is one command that starts the server in-process and finds a running copy by asking it

## Context

Starting Moon Base at work meant `PORT=… MOON_BASE_TERMINAL=cmux npm run dev`, typed from a cmux terminal, with a stale copy sometimes already on the port. The terminal launcher only works when the server is a descendant of a cmux terminal (cmux's socket answers nothing else), and browser storage is per origin, so a different port also means different settings.

## Decision

1. **One command, `moonbase1`, with subcommands.** No arguments (or `start`, or an option) starts Moon Base; `doctor` runs the doctor; `install-hooks`, `uninstall-hooks` and `hooks-status` go to the hook installer with their arguments untouched. The code is a new `cli/` directory behind `bin/moon-base.mjs`, and `package.json` gains `bin: { moonbase1 }`. `npm run moon-base -- <command>` keeps working. Nothing under `server/` or `src/` imports `cli/`, and a test scans for it, the same separation the hook installer already has. It is put on the PATH with a one-time `npm link`.
2. **The server runs inside the `moonbase1` process.** `server/serve.mjs` exports `serve({ port, host, dist })`, which rejects with the listen error, and still starts itself when run directly. In-process keeps the server in the terminal's process tree, which is what cmux's socket requires, and keeps Ctrl-C simple. An in-use port becomes a message, not a crash.
3. **The launcher is switched on the way it always was.** Inside cmux, recognised by `CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID` both being set, `moonbase1` sets `MOON_BASE_TERMINAL=cmux` in the server's environment, but only when the person has not set it: an explicit value, including one that turns the launcher off, is never overridden. A request still cannot choose or enable a launcher.
4. **It serves a ready build.** A build is made only when there is none or the newest modification time under `src/`, `public/`, `index.html`, `vite.config.js` or `package.json` is newer than `dist/index.html`. The build runs the asset step and then Vite with `process.execPath`, needing neither `npm` nor the PATH, and a failed build stops the start with its own output rather than serving something stale.
5. **A running copy is found by asking, not by a lock file.** A read-only `GET /api/identity` answers `{ app, version, pid, launcher }` and nothing about the machine. `moonbase1` asks every port from the default through the next twenty; a running Moon Base anywhere in the range is reused (the lowest port if there are two), even past a free port, and otherwise the first free port is used.

## Consequences

- One command is enough to start Moon Base, and it works the same inside and outside cmux, with the launcher on only where it can work.
- A copy started any other way (`npm run dev`, a terminal that has since closed) is found too, because nothing has to be written or cleaned up. A copy from before this change has no identity route, so it reads as "some other program" and is skipped, and a new copy starts on the next port.
- The server is now started from code other than `node server/serve.mjs`, so `serve()` is the seam, and a malformed `%` in a URL, which used to throw outside any handler, is refused instead of crashing a long-running process.
- The command opens the page with the OS opener (`open` or `xdg-open`). That is the command line opening a page for the person who ran it, not the server starting a process, so AC8's list of processes the server starts is unchanged.
- Windows is not a claimed platform, and nothing here changes that.

## Alternatives Considered

- **A lock or pid file in `~/.moon-base`.** Rejected: it misses copies started another way and goes stale when a process dies.
- **A child process for the server.** Rejected: an extra process to manage and signal, for no gain over in-process.
- **`npm start` as the entry.** It rebuilds every time.
- **Always-on start (a login item or menu-bar app).** Dropped: the launcher only works when started inside cmux, so an always-on server would be a viewer with copy-command only.

## Links

- `docs/features/moon-base/spec.md` (AC15)
- `docs/features/moon-base/plan.md` (D20 to D22, Unit 13)
- `docs/decisions/2026-09-26-terminal-handoff-copy-command-and-opt-in-launcher.md`
