---
title: Node's base64 decoder silently skips characters that are not base64
scope: repo
created: 2026-09-26
trigger: pattern
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - security
  - parsing
  - node
  - moon-base
---

# Node's base64 decoder silently skips characters that are not base64

## Lesson

`Buffer.from(text, 'base64')` does not reject bad input. It skips characters outside the alphabet, so `MmVkYzk3OTg…` with `!!` or a space inserted in the middle decodes to exactly the same bytes as the clean string. When the decoded value is used as an identity (a session id decoded from cmux's `workstreamId`), two different strings can name the same session, and a check on the decoded value alone will not notice.

## Applies When

- Decoding anything that becomes an id, a path, a key or a name.
- Writing a test for such a parser: a mutation that loosens the alphabet check survives unless the test sends junk that decodes cleanly.

## Do Instead

- Check the alphabet and shape first (`/^[A-Za-z0-9+/_-]+={0,2}$/`), then decode, then validate the decoded value against the pattern that value must have.
- Test with junk inserted into an otherwise valid encoding, not only with obviously broken input.

## Evidence

- `server/hooks/cmux.mjs`. The mutation that replaced the strict pattern with `/^.*$/` survived the first test run, because every rejected case in the test also failed the later id-pattern check. Adding inserted-junk cases killed it. Node confirmed the skipping directly.
