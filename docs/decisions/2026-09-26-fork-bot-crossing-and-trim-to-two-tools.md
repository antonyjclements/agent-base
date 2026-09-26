---
title: Fork Bot Crossing and trim it to Claude Code and Codex
date: 2026-09-26
status: active
tags:
  - architecture
  - upstream
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# Fork Bot Crossing and trim it to Claude Code and Codex

## Context

The visual colony of coding-agent sessions already existed as Bot Crossing (MIT), with adapters for seven tools including Claude Code and Codex. The goal was the same idea for exactly those two tools, with a different look and live status.

## Decision

Start from a copy of upstream at one pinned commit rather than a clean-room rebuild or a git fork. Keep the scanner, API, renderer and the two adapters; drop the other five adapters, terminal launching, and everything carrying upstream's reserved character. Record the commit in `UPSTREAM.md`, keep the MIT notice, credit upstream in the README, and take later upstream changes by hand.

## Consequences

- The renderer and adapters arrive working, and the work goes into what is different.
- The fork owns its divergence: no automatic sync, and upstream fixes have to be looked for.
- Anything that carries upstream's name, character or trademark-adjacent material has to be replaced, not kept.

## Alternatives Considered

- A clean-room rebuild: rejected as the slowest route for the same visible result.
- Running upstream as it is: it already supports both tools, but does not give live status, controlled opening, or an original identity.
- A git fork or subtree: rejected because about half the tree is dropped and the history is of no use here.

## Links

- `UPSTREAM.md`, `docs/features/moon-base/plan.md` (D1, D10)
