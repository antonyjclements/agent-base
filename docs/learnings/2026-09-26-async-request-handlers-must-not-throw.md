---
title: An async HTTP handler must not throw, because one bad request then ends the process
scope: repo
created: 2026-09-26
trigger: correction
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-cmux-launcher-and-v2-live-status
tags:
  - security
  - server
  - node
  - moon-base
---

# An async HTTP handler must not throw, because one bad request then ends the process

## Lesson

A Node `http` request handler that is an `async` function turns any throw into an unhandled rejection, and Node ends the process on those. In `server/serve.mjs`, a single request line such as `GET http://[ HTTP/1.1` made `new URL(req.url, base)` throw, and the connection hung and the process died. The line is hand-written: `fetch` and browsers tidy such addresses away, so ordinary testing never sends it. The same was true of `apiMiddleware`. A server that is meant to stay up (`moonbase1`) needs the whole handler wrapped, not just the one call that was already known to throw (`decodeURIComponent`).

## Applies When

- Writing or changing any request handler or middleware that is `async`.
- Refactoring a server so that it runs long-lived, in-process, instead of being restarted by a tool.

## Do Instead

- Wrap the entire handler body in try/catch and answer 400 for bad input and 500 for the rest.
- Parse the address inside that guard, never before it.
- Test with a raw socket and a hand-written request line, and listen for `unhandledRejection` in the test so a leak fails loudly.

## Evidence

- A review probe over a raw socket confirmed the crash for `GET http://[`, `GET //%zz` and `GET http://:80`. After the fix all three answer 400 and the server carries on.
