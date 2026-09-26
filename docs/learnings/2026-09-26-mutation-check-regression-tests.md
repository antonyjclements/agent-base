---
title: A regression test is only real once it fails with the fix removed
scope: repo
created: 2026-09-26
trigger: correction
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - testing
  - process
---

# A regression test is only real once it fails with the fix removed

## Lesson

A test written to guard a bug can pass without the fix, because it does not reproduce the interleaving or state that actually causes the failure. Two tests written for a concurrency bug in the events reader passed with the fix deleted. Only after tracing what the bug does (it over-advances a read offset, so events appended into the gap are skipped) did a test fail without the fix.

## Applies When

- Adding a test for a bug found in review or debugging, especially around concurrency, ordering or partial state.
- Claiming a test "guards" a fix in a summary or a review receipt.

## Do Instead

- Temporarily revert the fix, run the test, and confirm it fails for the reason you expect. Restore the fix and confirm the file is byte-identical.
- If it still passes, the story about the failure is wrong: trace the code path again and build the state that really breaks it.
- Say in the summary which tests were mutation-checked and which were not.

## Evidence

- Happened while reviewing the live-status reader in the Moon Base build. The third attempt at the test failed without the fix (6 events expected, 5 seen).
