---
title: Compare visual designs on a purpose-built lineup page, not by steering the live app's camera
scope: repo
created: 2026-09-26
trigger: dead-end
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - visual-checks
  - testing
  - moon-base
---

# Compare visual designs on a purpose-built lineup page, not by steering the live app's camera

## Lesson

Photographing one small bot inside the running colony took many attempts: scroll zoom did not always register, the locate button flew to a different place each time, a HUD panel pushed the subject out of frame, and scripted focus calls put the camera on the ground or under a building. A tiny page that draws the real head geometry for every option side by side gave a clear comparison in one screenshot.

## Applies When

- Choosing between designs of a part that appears small, animated or crowded in the full app.
- A screenshot is needed as evidence or as something for the user to decide from.

## Do Instead

- Write a small page under `tools/` that imports the same geometry or components the app uses and lays the variants out with fixed lighting and camera. `tools/look-lineup.html` is the example.
- Keep the live-app check for the end, to confirm the chosen variant renders without errors.
- Show the user the same page rather than describing it.

## Evidence

- Happened while choosing the bot design in the Moon Base build. The lineup page settled the choice in one view.
