---
title: Thread titles no longer pick up a skill's own loaded file or a slash command's wrapper tags
date: 2026-09-27
status: unprocessed
tags:
  - moon-base
  - claude-code
  - bugfix
---

## What Was Attempted

- The person saw a bot card titled "Base directory for this skill:..." and reported seeing several cards with the same title, from a screenshot on a branch (`feat/moon-base-fork`) that turned out to be theirs to ignore.
- Read the real transcript on this machine that reproduced it, found two causes in `readTranscriptMeta`/`cleanPrompt` (server/harnesses/claude-code.mjs), fixed both, added 5 tests, mutation-checked, and verified the fix against the real session (its title went from the skill's loaded file text to the actual typed command, "push everything directly to main").
- Separately answered why this very session's own bot was not showing in the colony: it is in `data/colony.json`'s own `archived` list (a colony-only, one-way action in the current build — there is no un-archive control in the UI), unrelated to the title bug.

## What Worked

- Reproducing against real `~/.claude/projects` data before writing any fix. Every existing test used synthetic fixtures that never modeled a real skill invocation's shape, so the bug was invisible to the suite.
- Checking the record's own `isMeta` field rather than guessing from the text's shape (no XML wrapper to strip) — a structural signal already in the data.
- A before/after comparison across every real session on the machine, done twice: the first pass conflated Claude Code's own auto-generated titles with the fix and wildly overstated the impact (69 of 76 "changed"); redone as an apples-to-apples comparison of only the changed step, the true count was 1 of 75.

## Corrections Made

- My first before/after comparison was methodologically wrong (compared old firstPrompt-only logic against the new *full* title-precedence chain, which includes Claude's own auto-title and is unaffected by this fix). Redone correctly and reported honestly rather than keeping the inflated number.

## Dead Ends

- None.

## Key Files

- `server/harnesses/claude-code.mjs` (`cleanPrompt`, `readTranscriptMeta`)
- `test/harness.test.mjs`
- `docs/learnings/2026-09-27-ismeta-marks-harness-injected-transcript-turns.md`

## Open Questions

- No un-archive control exists in the UI (`data/colony.json`'s `archived` list is the only way in, editing the file by hand is the only way out). Flagged as a separate task, not fixed here.
- Whether the wider "lots of these cards with the same title" the person described has another cause beyond this one confirmed instance is unresolved.
