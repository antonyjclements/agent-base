---
title: A transcript's `isMeta` flag marks what the harness injected, not what the person typed
scope: repo
created: 2026-09-27
trigger: pattern
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-27-thread-title-skips-harness-boilerplate
tags:
  - claude-code
  - parsing
  - moon-base
---

# A transcript's `isMeta` flag marks what the harness injected, not what the person typed

## Lesson

A Claude Code CLI transcript's `type: 'user'` records are not all things the person wrote. A slash command
or skill invocation adds records the harness generated on its own: a caveat, the command's own
`<command-name>`/`<command-message>` wrapper, and — separately, later in the same transcript — the skill
file's full loaded content. That last one is the trap: it is plain text with no wrapper tag around it, so a
cleaner built to strip `<tag>...</tag>` noise leaves it untouched, and it can win as if the person had typed
it. Observed on this machine (2026-09-27): a thread titled itself "Base directory for this skill:
/Users/.../skills/aw-commit-push-pr …" — the skill file's own first line — instead of what was actually
typed into that command.

The reliable signal is not the text's shape, it's the record's own `isMeta: true` field, which every one of
these harness-injected turns carries (confirmed across 71 such records on this machine — skill loads, the
caveat, and a few others). The person's real argument text, when there is any, survives in a *different*
field of a *non-meta* record: `<command-args>...</command-args>` inside the command-wrapper turn.

## Applies When

- Reading a Claude Code CLI transcript's `type: 'user'` records for anything meant to represent what the
  person asked — a title, a summary, a search index.
- Writing or reviewing a text cleaner that strips wrapper tags from prompt text: tag-shape alone cannot tell
  synthetic content from real content.

## Do Instead

- Skip `isMeta: true` records outright when looking for what the person said; do not try to guess from the
  text.
- When a record wraps a slash command, pull `<command-args>` out and use it if it's non-empty, before
  stripping the rest of the wrapper as noise — that content is a person's typed words, not decoration.
- Verify a title/summary heuristic against real `~/.claude/projects` transcripts, not only synthetic
  fixtures: the bug here was invisible in every existing test and only showed up against real data, because
  no existing fixture modeled a skill invocation's actual shape.

## Evidence

- `server/harnesses/claude-code.mjs`: `cleanPrompt` and `readTranscriptMeta`'s `firstPrompt` search, fixed
  and covered by 5 new tests in `test/harness.test.mjs`. Verified against the one real session on this
  machine that the bug affected.
