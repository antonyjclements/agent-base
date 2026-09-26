---
title: How the claude:// and codex:// deep links actually behave
scope: repo
created: 2026-09-26
trigger: pattern
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - url-schemes
  - claude-code
  - codex
  - moon-base
---

# How the claude:// and codex:// deep links actually behave

## Lesson

`claude://` is registered by Claude.app and `codex://` by ChatGPT.app. Observed behavior on this machine:

- `codex://threads/new?path=<dir>` opens a new chat in that folder and creates no thread until a message is sent.
- `codex://threads/<id>` opens a thread that was created from the CLI.
- `claude://resume?session=<cli id>` imports the CLI transcript as a new desktop record named `local_<CLI UUID>`, linked back through `cliSessionId`.
- `claude://claude.ai/epitaxy/<desktop id>` focuses that desktop session, visible as an updated `lastFocusedAt` in its record.
- `claude://code/new?folder=<dir>` created no record and its window was not observed.

## Applies When

- Building or changing the open and new-session controls.
- Deciding which sessions can be marked openable.
- Verifying deep links in a test.

## Do Instead

- Build these links in one place per adapter, from encoded parts, and treat the shapes above as observed rather than documented, since app updates can change them.
- Warn the user before opening a CLI-only Claude session, because it creates a new desktop session.
- To verify Claude's links, check the record files and ask a person to look at the window. Claude cannot be granted computer-use control of its own window, so ChatGPT.app can be screenshotted but Claude.app cannot.

## Evidence

- Observed during the Unit 1 live verification of the Moon Base plan with throwaway sessions. Recorded in `docs/features/moon-base/spec.md` under Spike findings.
