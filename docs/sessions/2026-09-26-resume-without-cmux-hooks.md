---
title: Resume's already-open check without cmux's Claude hooks, and a doctor that says why
date: 2026-09-26
status: unprocessed
tags:
  - moon-base
  - cmux
  - resume
  - doctor
---

## What Was Attempted

- Diagnosed two work-machine symptoms (the doctor said the cmux stream was "not found", and every Resume opened a second workspace) as one cause: cmux's Claude Code integration is off there, so cmux's wrapper injects no hooks and neither `~/.cmuxterm/workstream.jsonl` nor `claude-hook-sessions.json` (the only file `cmux sessions` reads) is ever written. The person confirmed it.
- Built the hook-free Resume check on branch `feat/resume-without-cmux-hooks`: the launch route also asks an optional adapter method `sessionRunning(id)`, which for Claude Code reads Claude's own live-session marker. Added `cmuxSessionsSummary`, a Resume check row and a terminal count to the doctor, a `launchNote` for the page, spec, plan (Unit 16, D25 to D27), README, a decision and a learning. 494 tests; 19 mutations checked, all caught.

## What Worked

- Reading cmux's own wrapper script and `cmux sessions` output before proposing anything: it showed the single store and the `CMUX_CLAUDE_HOOKS_DISABLED` opt-out, and turned a guess into a diagnosis.
- Checking the real markers first found that all desktop-app markers say `entrypoint: claude-desktop` and the terminal one says `cli`. Counting every marker would have stopped terminal Resume for any thread the desktop app keeps warm.
- A real-data check with the real adapter, plus writing tests first and watching them fail.

## Corrections Made

- The v2 plan assumed cmux's hooks fire at work (M7). They do not there, because the integration is off. Recorded in the spec and a learning.
- My first real-check idea used this very session, which is a desktop-app one and is correctly ignored. The real `cli` marker was the right one to use.

## Dead Ends

- A process start-time check to catch a reused pid was rejected: it needs a new process-spawning site (the security test allows exactly three files) and the marker's `procStart` is UTC while `ps` prints local time. Recorded as a known limit in D26.
- Two existing doctor tests called `doctor()` directly, so they would have run a real `cmux` on any machine that has it. They now stub it.

## Key Files

- `server/harnesses/claude-code.mjs`, `server/scan.mjs`, `server/api.mjs`, `server/lib/terminal.mjs`, `cli/doctor.mjs`, `src/game/open-mode.js`
- `docs/features/moon-base/spec.md`, `docs/features/moon-base/plan.md`, `docs/decisions/2026-09-26-resume-already-open-falls-back-to-claudes-own-marker.md`

## Open Questions

- Manual check M10 at work: that a resumed session keeps its id in the live marker (inferred from cmux keying on the same id, not seen directly), and that Claude writes marker files there at all.
- Whether other hosts besides the desktop app pre-warm idle processes and would wrongly hold Resume back (the desktop-app exclusion is a denylist).
- Codex resume still depends on cmux's record.
