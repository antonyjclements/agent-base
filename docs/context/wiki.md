---
generated: 2026-09-26
sessions_synthesized: 1
---

# Project Context Wiki

> Generated 2026-09-26 by aw-synthesize-memory from 1 session logs. Do not edit manually.
> If this date is more than 30 days old, or several unprocessed session logs have accumulated
> since, treat this wiki as stale: verify against docs/features/, docs/decisions/, and
> docs/learnings/ directly, and re-run aw-synthesize-memory.

## Active Features

- Moon Base — docs/features/moon-base/spec.md — a local 3D colony of Claude Code and Codex sessions. Units 1 to 7 are built; live-tool checks, human review and the first commit are pending. The plan is docs/features/moon-base/plan.md.

## Recent Decisions

- 2026-09-26 Fork Bot Crossing and trim it to two tools — a working renderer and adapters from day one. docs/decisions/2026-09-26-fork-bot-crossing-and-trim-to-two-tools.md
- 2026-09-26 The opt-in installer is the only config writer — the server and page can never edit a tool's config. docs/decisions/2026-09-26-opt-in-hook-installer-is-the-only-config-writer.md
- 2026-09-26 Sessions open through URL schemes only — no request can start a command. docs/decisions/2026-09-26-open-sessions-through-url-schemes-only.md
- 2026-09-26 Live status from one shared hook and a private events file — events colour existing bots and never create one. docs/decisions/2026-09-26-live-status-through-a-shared-hook-and-events-file.md
- 2026-09-26 Original bot on CC0 art, shipped look Rover — clean identity and licensing. docs/decisions/2026-09-26-original-bot-from-cc0-art-rover.md

## Top Learnings

None yet: a learning becomes active only after three sessions corroborate it.

## Tentative Learnings

Not authoritative until corroborated.

- How the claude:// and codex:// deep links actually behave — docs/learnings/2026-09-26-claude-and-codex-url-schemes-observed.md
- A long CODEX_HOME path breaks the Codex TUI's app-server socket — docs/learnings/2026-09-26-codex-home-path-length-limit.md
- Codex trusts hooks individually and skips untrusted ones silently — docs/learnings/2026-09-26-codex-hook-trust-model.md
- Codex invocations can change global state on the machine — docs/learnings/2026-09-26-codex-runs-change-global-state.md
- Hand trust and permission steps to the user instead of automating them — docs/learnings/2026-09-26-hand-trust-steps-to-the-user.md
- Claude Code and Codex hook events, as observed — docs/learnings/2026-09-26-hook-events-claude-code-and-codex.md
- A regression test is only real once it fails with the fix removed — docs/learnings/2026-09-26-mutation-check-regression-tests.md
- Compare visual designs on a purpose-built lineup page, not by steering the live app's camera — docs/learnings/2026-09-26-preview-designs-on-a-purpose-built-page.md
- Quote the heredoc delimiter when the body contains backticks or dollar signs — docs/learnings/2026-09-26-quote-heredocs-with-backticks.md
- Where session data lives and how session IDs behave — docs/learnings/2026-09-26-session-store-and-id-facts.md

## Known Dead Ends

- Answering a tool's trust or permission prompt by scripting its terminal UI, or with a bypass flag: it stalls, can accept update prompts, and is blocked as a safety bypass. Hand the user the command.
- A very long CODEX_HOME path: the Codex TUI's socket path overflows. Use a short path or --no-daemon.
- Steering the live app's camera to photograph one small bot: unreliable. Use tools/look-lineup.html.
- Unquoted heredocs containing backticks in shell tools: the shell runs them.
- A regression test that was never run against the broken code: it may pass either way.

## Useful Sources

- docs/features/moon-base/plan.md — units, decisions and traceability to tests.
- server/harnesses/README.md — the adapter contract.
- public/assets/CREDITS.md — art sources, licenses and hashes.
- test/support/fixtures.mjs — fake Claude Code and Codex installs used by every test.
