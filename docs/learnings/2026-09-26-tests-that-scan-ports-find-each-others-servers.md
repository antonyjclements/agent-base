---
title: A test that searches a port range can find, and reuse, another test file's server
scope: repo
created: 2026-09-26
trigger: correction
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-cmux-launcher-and-v2-live-status
tags:
  - testing
  - flaky-tests
  - macos
  - moon-base
---

# A test that searches a port range can find, and reuse, another test file's server

## Lesson

`node --test` runs test files in parallel processes, and several of them here start real servers that answer `/api/identity`. macOS hands out ephemeral ports one after another, so a "free" port obtained by binding port 0 usually has a sibling test's server within a few ports of it. A test of `moonbase1 start`, which searches twenty ports for a copy that is already running, then legitimately found and reused that server, and failed about half the time. The code was right and the test was not hermetic.

## Applies When

- Testing anything that scans, probes or reuses ports.
- A test passes alone and fails intermittently in the full run.

## Do Instead

- Pick the port from a range nothing else uses (here 20000 to 40000, checked free), not from the system's own choice.
- When a test fails only in parallel, suspect shared resources (ports, temp paths, environment) before suspecting the code, and read the failure for what the code actually did.

## Evidence

- `test/cli-start.test.mjs`: the real-server test failed in 2 of 4 parallel runs before, and in none of 6 runs after.
