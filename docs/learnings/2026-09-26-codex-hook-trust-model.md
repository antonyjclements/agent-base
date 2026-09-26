---
title: Codex trusts hooks individually and skips untrusted ones silently
scope: repo
created: 2026-09-26
trigger: pattern
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - hooks
  - codex
  - trust
  - moon-base
---

# Codex trusts hooks individually and skips untrusted ones silently

## Lesson

Codex records trust per hook in `[hooks.state]` of `~/.codex/config.toml`, keyed by `<hooks.json path>:<event in snake_case>:<group index>:<handler index>` with a hash of the hook's definition. A hook without a trust entry is skipped with no message, even when the project itself is trusted.

## Applies When

- Installing, updating or removing hooks that Codex should run.
- Debugging a Codex hook that never fires.
- Anything that edits or reorders existing hook entries.

## Do Instead

- Keep the command string and each entry's position stable. Append new entries and never reorder existing ones, or trust for those entries is lost.
- Update the hook's script freely. Changing only the script's contents, with the same command string, did not require re-trust.
- After installing, tell the user to review and trust the hooks with `/hooks`, and detect "installed but no event has ever arrived" to remind them.
- Never use `--dangerously-bypass-hook-trust` in the product.
- Expect `SessionEnd` and `Interrupt` timeouts to be clamped to 3 seconds, and expect Codex to print two visible lines per hook per event (14 lines for a two-tool turn), so register few events.
- A user-level `hooks.json` next to `[hooks.state]` in `config.toml` produced no merge warning.

## Evidence

- Observed during the Unit 1 live verification of the Moon Base plan, in an isolated Codex home with the user's own `/hooks` review. Recorded in `docs/features/moon-base/spec.md` under Spike findings.
