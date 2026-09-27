---
title: A way to open that only brings cmux to the front
date: 2026-09-26
status: active
tags:
  - terminal
  - cmux
  - security
  - settings
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# A way to open that only brings cmux to the front

## Context

On the work machine sessions already run in cmux and hooks are unavailable, so Moon Base cannot report what they are doing live. The person's wish for Open there is small: get to cmux. Terminal mode does more than that (it resumes or starts a session, and asks whether one is already running first), and cmux's CLI has no command to select the workspace that holds a session, so the most Moon Base can do for "take me to that session" is raise the application.

## Decision

`Open sessions with` gains a fifth choice, "Bring cmux to the front" (`foreground`). Open and the new-thread buttons then do one thing: the server runs `open -a cmux` once. The new route, `POST /api/terminal-foreground`, needs the launcher on (the environment's choice, as for `terminal-launch`), reads and ignores the request body, takes no thread, folder, command or launcher from it, and runs the one argument list the server already builds for bringing cmux forward after a launch. It answers `{ ok: true }`, or one fixed sentence when it could not. A stored choice with no launcher copies instead, exactly like Terminal.

`runForeground` now resolves `{ ok }` rather than nothing. The calls after a launch ignore it, as before; this route's whole purpose is the result, so a failure must not be reported as success. The runner's own words are never passed on.

## Consequences

- A page click can now start a process without a thread or folder in the request. The surface stays the same shape as the rest of AC13: the environment decides whether it exists, the argument list is fixed and hardcoded in the server, no request field reaches it, and the same Host and Origin checks apply. `test/open-security.test.mjs` still allows exactly one `open` spelling and three files that import `child_process`, and both still pass.
- Nothing else about Terminal mode changes: it still checks for a running session and resumes.
- It works on macOS only, and says so plainly elsewhere.
- It cannot take the person to the right workspace, only to the application. That limit is cmux's, recorded in the spec.
- The page half is not unit-tested (it lives in the scene); it was checked in a real browser and with a real click, and a manual check is listed for the work machine.

## Alternatives Considered

- **Make Terminal mode skip the launch when it is not needed.** It already skips a launch for a session it can see is running, but it launches for anything else, which is not what was asked.
- **A `cmux://` link from the page.** cmux registers that scheme for authentication only, and the page cannot raise an application by itself anyway.
- **Select the session's workspace.** cmux's CLI has no such command.
- **Reuse `terminal-launch` with a flag.** That route reads a thread or folder from the request; a route that reads nothing is a smaller thing to trust.

## Links

- `docs/features/moon-base/spec.md` (AC13)
- `docs/features/moon-base/plan.md` (D28, Unit 17)
- `docs/decisions/2026-09-26-terminal-handoff-copy-command-and-opt-in-launcher.md`
