---
title: An Open sessions with choice that only brings cmux to the front
date: 2026-09-26
status: unprocessed
tags:
  - moon-base
  - cmux
  - settings
  - ui
---

## What Was Attempted

- Started on the doctor's "hooks blocked" detection and the docs correction (queued items 1 and 2) and a look at what `~/.claude/sessions` can offer at work. The person interrupted the reading of Claude's binary and redirected: one `Open sessions with` choice should just bring cmux to the front.
- Built it on branch `feat/open-mode-foreground`: a `foreground` mode, a fixed route `POST /api/terminal-foreground`, `runForeground` now reporting `{ ok }`, a "Show" button label and tooltips, spec AC13, plan D28 and Unit 17, README and a decision. 506 tests; 13 mutations checked, all caught.
- Checked the page half in a real browser and with a real click: `POST /api/terminal-foreground` returned 200 and macOS reported cmux as the frontmost app.

## What Worked

- Measuring in the browser found what no test could: the first option label widened the select from 273px to 361px, pushing it out of its 286px row and collapsing the settings row. Measuring candidate labels against the old longest one gave a label of the same width.
- Removing the new option in the live page to compare showed the row was already crushed when the launcher is off, so the pre-existing bug was reported instead of being fixed inside the feature.
- Asking macOS for the frontmost application before and after the click proved the real effect, not just the 200.

## Corrections Made

- An existing security test counts the literal `open` in `terminal.mjs` and expects exactly one. A doc comment of mine quoted it a second time; the comment was reworded and the guard left alone.
- The person stopped me reading the Claude binary. I stopped, changed nothing, and continued with what they asked.

## Dead Ends

- My first clicks did nothing because the Settings panel still held focus and I had mis-scaled the click coordinates; the network log showed no request was sent, which is how I knew it was the click and not the server.

## Key Files

- `server/api.mjs`, `server/lib/terminal.mjs`, `src/game/open-mode.js`, `src/main.js`, `src/ui/hud.js`
- `docs/decisions/2026-09-26-open-mode-that-only-brings-cmux-to-the-front.md`

## Open Questions

- Queued, not started: the doctor should say when hooks are blocked at work (cmux's settings attached to a running Claude but no Claude events recorded, and the managed policy flags), and the spec, plan and learning should record that policy blocks hooks on the work machine.
- Claude's own session marker seems to have a third status, `waiting`, with a `waitingFor` reason, seen in strings in the installed binary but not yet observed in a marker on disk. If real, it would give an awaiting-input signal at work with no hooks.
- The settings "Open sessions with" row is crushed when the launcher is off (label column 1px wide at a 1024px window). Pre-existing, reported separately.
- Manual check M11 at work.
