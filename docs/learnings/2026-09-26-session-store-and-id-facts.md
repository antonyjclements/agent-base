---
title: Where session data lives and how session IDs behave
scope: repo
created: 2026-09-26
trigger: pattern
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - storage
  - session-ids
  - codex
  - claude-code
  - moon-base
---

# Where session data lives and how session IDs behave

## Lesson

- Claude Code CLI transcripts are `~/.claude/projects/<encoded-path>/<uuid>.jsonl`. Claude desktop records are `local_<uuid>.json` files under `~/Library/Application Support/Claude/claude-code-sessions`, each with a `cliSessionId` linking to the CLI transcript.
- Codex transcripts are `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`, and thread metadata is in the `threads` table of `~/.codex/state_5.sqlite` (with `id`, `rollout_path`, `cwd`, `title`, `git_branch`, `archived`, `updated_at_ms`, `model` and `preview` among its columns).
- `node:sqlite` opens `~/.codex/state_5.sqlite` read-only on Node 22.22 with no flag, printing only an experimental warning.
- The first 8 hex characters of Codex UUIDv7 IDs repeat across different sessions within minutes.

## Applies When

- Writing or testing the session adapters.
- Displaying, logging or matching session IDs.

## Do Instead

- Always use the full ID for matching and keys, and shorten only for display.
- Suppress the `node:sqlite` experimental warning explicitly and open the database read-only.
- Skip the Codex SQLite `threads` columns you don't need, since the schema is versioned by file name and can change.

## Evidence

- Observed during the Unit 1 live verification of the Moon Base plan. Recorded in `docs/features/moon-base/spec.md` under Spike findings.
