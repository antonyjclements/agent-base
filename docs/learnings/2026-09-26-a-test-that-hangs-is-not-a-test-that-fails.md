---
title: A test that waits on a server must time out itself, or a broken server hangs the run
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
  - mutation-testing
---

# A test that waits on a server must time out itself, or a broken server hangs the run

## Lesson

Two mutations to `server/serve.mjs` (a request handler that throws before answering, and a `listen` error that is swallowed) made the tests wait forever rather than fail. `node --test` has no default timeout, so the mutation run stalled for minutes and only ended when the test process was killed by hand. A killed run also prints no `not ok` line, so the mutation script counted one of them as surviving even though the test had "caught" it by hanging.

## Applies When

- Writing a test that makes an HTTP request, waits for a server to listen, or awaits a promise a broken implementation might never settle.
- Running mutation checks over such tests.

## Do Instead

- Give every such wait its own bound: a request `timeout` that destroys the request, and a `Promise.race` against a short timer for anything that should settle. A hang then becomes an ordinary failure with a message.
- Run mutation checks with `node --test --test-timeout=<ms>` as a second line of defence.

## Evidence

- `test/serve.test.mjs` before and after: the first mutation run stalled on "a bad `%` crashes the server" and "serve swallows the listen error" until the process was killed. With `within(...)` and a request timeout, both fail in about a second.
