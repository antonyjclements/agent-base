---
title: Hand trust and permission steps to the user instead of automating them
scope: repo
created: 2026-09-26
trigger: correction
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - process
  - safety
  - testing
---

# Hand trust and permission steps to the user instead of automating them

## Lesson

When a check needs the user's own trust or permission decision, give the user the exact terminal command and let them answer the prompt. Do not use a safety-bypass flag to skip it, and do not script a TUI to answer for them. In the spike, an attempt to run Codex with `--dangerously-bypass-hook-trust` (in an isolated scratch home, with a probe hook that was our own) was blocked by the auto-mode classifier as a safety bypass. Driving the Codex TUI through a pty stalled on loading and risked accepting an update prompt with a stray Enter.

## Applies When

- A check needs a trust dialog, a permission prompt or an update prompt answered.
- A tool offers a flag that skips a safety check.

## Do Instead

- Set up the scratch files, print one command for the user in its own code block, and read the resulting logs afterwards.
- Keep the approval scope to what the user actually agreed to. Granting trust inside a scratch home does not extend to bypassing trust.
- Prefer non-interactive runs such as `codex exec` and `claude -p` for everything that does not need a human answer.

## Evidence

- Happened during the Unit 1 live verification of the Moon Base plan. The user then ran the Codex trust review themselves and the hooks were captured without any bypass.
