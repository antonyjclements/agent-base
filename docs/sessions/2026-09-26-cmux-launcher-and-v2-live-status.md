---
title: Terminal hand-off with a cmux launcher, then v2 spec, plan and build of hook-free live status and moonbase1
date: 2026-09-26
status: unprocessed
tags:
  - moon-base
  - cmux
  - live-status
  - cli
---

## What Was Attempted

- Answered licence and work-use questions (MIT chain, CC0 art, no desktop app or hooks at work), then built the terminal hand-off (AC13): a copied command and an opt-in cmux launcher. Pushed to `main`.
- Ran it against a live cmux. That found two real bugs, a duplicate `--resume` on an already-open session and cmux never coming to the foreground, both fixed and pushed.
- Assessed a village or farm theme (KayKit Medieval Hexagon) and parked it.
- Brainstormed v2, specified slice 1 and easy start as AC14 and AC15, and planned Units 11 to 15.
- Built Units 11 to 14 on `feat/v2-cmux-live-status`: cmux's event stream and Claude's busy/idle marker as live sources, the chip and Automatic open mode, `moonbase1` start and doctor. 451 tests, about 90 mutations checked.

## What Worked

- Reading real data before designing: `cmux sessions` needs no socket and gave the already-open check; `workstream.jsonl` gave the row shape, and its `status: pending` rows settled what `question` means.
- Acceptance-first tests, then mutating each rule. It found real gaps every unit.
- Running the real thing: the doctor on real files, a real start and rebuild, and the chip in the real page.

## Corrections Made

- A docs summary said `cmux new-workspace` had no working-directory option; the installed CLI's own help showed `--cwd`. Trust `--help` over a summary.
- "No robot" and "resume opens a new workspace" were the same flow: Resume on an existing bot. The duplicate-launch fix and the foreground fix came from the person testing it.
- Always-on start was dropped by the person; easy start stayed.

## Dead Ends

- Mutation runs hung on two server tests with no timeouts, so the run stalled until killed. The tests now time out themselves.
- The Live chip beside the title collapsed the title to zero width. Text tests could not see it; it now has its own line.
- Node's base64 decoder skips junk, so a strict alphabet check is needed before decoding an id.
- Review found that one malformed request line could crash the long-running server, and that a real-server test was not hermetic (it reused a sibling test's server). Both fixed.

## Key Files

- `server/hooks/cmux.mjs`, `server/hooks/events.mjs`, `server/hooks/live.mjs`, `server/harnesses/claude-code.mjs`
- `cli/`, `bin/moon-base.mjs`, `server/serve.mjs`, `server/api.mjs`
- `src/game/live-chip.js`, `src/game/open-mode.js`, `src/ui/hud.js`
- `docs/features/moon-base/spec.md`, `docs/features/moon-base/plan.md`, `docs/brainstorms/2026-09-26-001-v2-roadmap-idea.md`

## Open Questions

- Manual checks M7 to M9 at the work machine: whether cmux's stream fills there, whether `npm link` is allowed, and Codex rows.
- No human reviewer is configured; the change is High-Risk per `AGENTS.md`. An adversarial review pass was run (1 P1, 3 P2, 3 P3, all fixed).
