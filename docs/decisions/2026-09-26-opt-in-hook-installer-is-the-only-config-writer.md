---
title: The opt-in hook installer is the only thing that writes a tool's config
date: 2026-09-26
status: active
tags:
  - security
  - hooks
  - installer
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# The opt-in hook installer is the only thing that writes a tool's config

## Context

Upstream's rule is that it never writes to a tool. Live status needs hooks, and hooks live in the tools' own config files (`~/.claude/settings.json`, a Codex `hooks.json`). During the spike, Codex and its desktop app were both seen rewriting `~/.codex/config.toml` on their own.

## Decision

Moon Base writes a tool's config in exactly one place: a command-line installer (`hooks/`, run through `npm run moon-base`). It shows the exact diff and asks before each tool, has no option to skip the question, refuses without a terminal, appends after the user's own entries and never reorders them, writes atomically, refuses if the file changed during the review, and records what it created so uninstalling restores the original bytes. The server and page code cannot reach it, and a test fails if they mention where a tool keeps its config. Codex hooks go in a `hooks.json` Moon Base owns rather than in `config.toml`, and Codex's trust review and `notify` setting are never touched or bypassed.

## Consequences

- Live status is opt-in, with a fallback to inferring status from files.
- Codex will not run the hooks until the user trusts them through its own `/hooks` review, so `hooks-status` says so when nothing has arrived.
- Everything the installer does is reversible and visible before it happens.

## Alternatives Considered

- Printing a snippet for the user to paste: safest, but fragile and easy to get wrong for two tools.
- Editing `config.toml` for Codex: rejected because Codex rewrites that file itself and TOML edits lose comments.
- Installing hooks automatically at first run: rejected outright.
- A button in the page: rejected because a web page must never be able to edit tool configs.

## Links

- `docs/features/moon-base/spec.md` (AC5), `docs/learnings/2026-09-26-codex-hook-trust-model.md`
