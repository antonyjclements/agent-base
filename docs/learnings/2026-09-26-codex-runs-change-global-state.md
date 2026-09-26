---
title: Codex invocations can change global state on the machine
scope: repo
created: 2026-09-26
trigger: pattern
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - codex
  - global-state
  - testing
  - moon-base
---

# Codex invocations can change global state on the machine

## Lesson

Treat every Codex invocation as a possible writer of global state. During the spike, the first run against the real Codex home added a trusted-project entry for the scratch folder to `~/.codex/config.toml`. The ChatGPT desktop app rewrote the same file with its own project entry while the work was going on. The globally installed Codex CLI was also upgraded from 0.135.0 to 0.157.1 by an `npm install --global` run during the session, and the cause was not confirmed. Runs against an isolated `CODEX_HOME` did not touch the real config.

## Applies When

- Running Codex in tests, spikes or scripts.
- Deciding whether a tool should edit `~/.codex/config.toml`.
- Reporting which Codex version a result came from.

## Do Instead

- Run experiments with `CODEX_HOME` pointed at a scratch directory, with a symlink to the existing auth file so credentials are never copied, and pass `-m` for a model the installed CLI supports.
- Note the modification time and structure of `~/.codex/config.toml` before and after any run against the real home.
- Never make a tool depend on editing `config.toml`. Keep hook definitions in a `hooks.json` the tool owns.
- Re-check `codex --version` after runs, since the CLI can change underneath you.

## Evidence

- Observed during the Unit 1 live verification of the Moon Base plan and recorded in `docs/features/moon-base/spec.md` under Spike findings ("Tool configs are written by others").
