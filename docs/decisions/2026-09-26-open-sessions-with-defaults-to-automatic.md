---
title: The Open sessions with setting defaults to Automatic
date: 2026-09-26
status: active
tags:
  - ui
  - settings
  - cmux
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# The Open sessions with setting defaults to Automatic

## Context

Inside cmux with no desktop app, a fresh install should start on Terminal so the first click works, but keep Desktop app where a launcher is not on. The obvious rule, "use Terminal until the person has chosen something else", needs to know whether the person has chosen. That cannot be read back from browser storage: it is per origin (the port is part of it, and `moonbase1` can pick a different port), and every settings write stores the whole settings object, so a value that was never touched is stored as if it had been.

## Decision

`openWith` defaults to `auto`, and the select gains an Automatic entry. `auto` is the terminal when the server has a launcher on, and the desktop app when it does not. Desktop app, Copy terminal command and Terminal remain explicit choices and keep their meaning, and a stored choice is never changed by what the server detects.

## Consequences

- A fresh install is right in both worlds without asking, and stays right if the port (and so the origin) changes.
- Installs that already stored `app`, `copy` or `terminal` keep it. Installs that stored settings before this field existed have no `openWith` and become Automatic, which behaves as Desktop app unless a launcher is on.
- "Automatic" is one more option in a select and one more case in `resolveOpenMode`, tested on its own.

## Alternatives Considered

- **A separate "has chosen" flag.** More state to keep in step with the setting, and it has the same per-origin storage problem.
- **Default to Terminal.** Wrong for anyone with the desktop apps and no launcher, where it would fall back to copying.
- **Ask on first run.** A prompt for something the environment already answers.

## Links

- `docs/features/moon-base/spec.md` (AC15)
- `docs/features/moon-base/plan.md` (D23, Unit 12)
