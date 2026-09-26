---
title: The bot is an original design on CC0 art, and the shipped look is Rover
date: 2026-09-26
status: active
tags:
  - art
  - identity
  - licensing
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# The bot is an original design on CC0 art, and the shipped look is Rover

## Context

Upstream reserves its name and its newer character designs as its own identity, and its built art carries that character. The colony still needs a rigged, animated bot.

## Decision

Rebuild every model from CC0 packs taken from their original sources (KayKit and Kenney), and never copy upstream's built assets or design drafts. The bot keeps KayKit's mannequin and animations, and gets a head designed in Moon Base's own code: a squircle head shaped from the same procedural parts, with its own fittings and paint. Three looks were built and compared side by side, and Rover (a squat survey bot with a wide, low head, side lamps and sand paint) was chosen. The others stay selectable with `?look=lantern` or `?look=dish`. A test rules out any shipped look that has a plain spherical head, upstream's round side discs, or upstream's white suit paint. Sources, license and archive hashes are recorded in `public/assets/CREDITS.md` and checked by a test.

## Consequences

- The visual identity, the art licensing and the attribution are all clean and checkable.
- The look is procedural, so it can be changed by editing code without new art.
- Upstream's reserved character and TRADEMARKS constraints are respected without asking anyone.

## Alternatives Considered

- Reusing upstream's assets and changing only the name and palette: rejected as leaning on a character that upstream reserves.
- Commissioning or generating all-new models: the slowest route, and unnecessary for a head-shape identity.

## Links

- `public/assets/CREDITS.md`, `src/agents/looks.js`, `test/looks.test.mjs`
