---
title: A long CODEX_HOME path breaks the Codex TUI's app-server socket
scope: repo
created: 2026-09-26
trigger: dead-end
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - codex
  - testing
  - macos
---

# A long CODEX_HOME path breaks the Codex TUI's app-server socket

## Lesson

The interactive Codex TUI starts a background app server that listens on a Unix socket under `CODEX_HOME`. macOS limits socket paths to about 104 bytes, so a `CODEX_HOME` in a deep scratch directory (175 bytes for the socket path here) makes the TUI fail with "path must be shorter than SUN_LEN". Non-interactive `codex exec` worked with the same long path.

## Applies When

- Pointing `CODEX_HOME` at a scratch or temp directory for the TUI.
- Seeing "app server did not become ready" from Codex.

## Do Instead

- Use a short `CODEX_HOME` path, or run the TUI with `--no-daemon`, which the error message also suggests.
- Use `codex exec` where a TUI is not needed.

## Evidence

- Hit while the user ran the Codex trust review in an isolated home during the Unit 1 live verification of the Moon Base plan. An earlier scripted TUI session stalled at "loading" for the same reason.
