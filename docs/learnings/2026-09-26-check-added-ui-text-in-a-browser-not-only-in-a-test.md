---
title: Text added to fixed-size UI needs a real browser check, because tests of the text cannot see overlap
scope: repo
created: 2026-09-26
trigger: correction
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - ui
  - testing
  - visual-checks
  - moon-base
---

# Text added to fixed-size UI needs a real browser check, because tests of the text cannot see overlap

## Lesson

The Live chip's text is unit-tested as a pure function, and every one of those tests passed. In the real page, adding `· cmux ○` made the chip 239px wide inside a header with about 170px to spare, and the flex layout collapsed the "Moon Base" title to zero width and drew the chip over it. The chip had been too wide for the header before this change; the longer text made it obvious. Only running the page and measuring showed it.

## Applies When

- Adding or lengthening text in the HUD, especially in the fixed 320px side panel.
- Reviewing a change whose tests only check strings.

## Do Instead

- Run the page and measure: `getBoundingClientRect()` on the neighbouring elements and an overlap test, plus a screenshot. It is a few lines in the browser tool.
- Prefer giving a variable-length element its own line over squeezing it beside fixed ones, so the layout does not depend on how long the text gets.

## Evidence

- `src/ui/hud.js` and `src/ui/styles.css`: the chip moved from the header row to its own line under it. Measured after: the title 167px wide with no overlap, the chip on its own row.
