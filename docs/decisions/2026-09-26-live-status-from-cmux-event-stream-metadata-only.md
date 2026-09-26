---
title: Live status also comes from cmux's own event stream, read automatically and metadata only
date: 2026-09-26
status: active
tags:
  - security
  - privacy
  - live-status
  - cmux
related_specs:
  - docs/features/moon-base/spec.md
supersedes: []
---

# Live status also comes from cmux's own event stream, read automatically and metadata only

## Context

The live-status decision ([one shared hook that appends to a private events file](2026-09-26-live-status-through-a-shared-hook-and-events-file.md)) needs Moon Base's own hooks installed. At work, with Claude Code CLI in cmux, there is no access to Claude hooks, so status is only inferred from session files and lags, and there is no "waiting on you" signal.

cmux already records what agents are doing. On 2026-09-26 (read-only, personal machine) its append-only `~/.cmuxterm/workstream.jsonl` held rows of kind `sessionStart`, `userPrompt`, `toolUse`, `toolResult`, `permissionRequest`, `question`, `stop` and `sessionEnd`, with the session id encoded in `workstreamId`. Decoded ids joined to a real transcript for 4 of 5 sessions. The user confirmed cmux shows agent status for Claude sessions on the work machine, so cmux's own hooks fire there. The same rows carry message content in `payload`.

Claude Code's own live marker (`~/.claude/sessions/<pid>.json`) also has a `status` (`busy` or `idle`) that the adapter does not use today.

## Decision

Use cmux's stream, and Claude's own marker, as additional live sources, laid over the files exactly as hook events are today.

1. **Automatic, visible, easy off.** The cmux source is used whenever its files exist. The Live chip names cmux when it is reporting and shows it as not reporting when it is not. An environment variable turns it off, and then the files are never read.
2. **Metadata only.** From a row Moon Base reads the event kind, the session id, the folder and timestamps. Everything else in the row, including any message content, tool input or prompt text, is dropped when the row is read: never kept, logged, served to the page or written anywhere.
3. **Read-only and socket-free.** Nothing is written to cmux's files or to any tool config, and no cmux socket connection is used, so it works when Moon Base was started outside cmux.
4. **Layered, with files as the floor.** A source only colours a session the scan already found and never creates a bot. A signal for a session nobody has scanned is held briefly, then dropped. Every state expires and hands the session to the next source or to the files with no error. This is the rule the hook pipeline already follows.
5. **Claude Code first.** Codex is best-effort, wherever cmux reports it.

## Consequences

- Live status works at work with nothing installed and nothing written, and needs no change to any tool's config, so AC3 and AC5 are untouched.
- The stream's format (`cmux-feed-v1`) is undocumented and can change with cmux. It gets one adapter with fixtures and a diagnostic, the same isolation used for the URL schemes, and anything unrecognised reads as "not reporting".
- Rows contain message content, so a test with sentinel content in fixture rows must prove it never reaches the page, the API, logs or any file Moon Base writes. That test is part of done.
- Reading another app's private files is a small privacy step beyond the tools' own session files, which is why the source is visible on the Live chip and can be switched off.
- Retention and rotation of `workstream.jsonl` are not yet known (40 rows over about 65 minutes were observed), so a cold start may see only recent events. States are then inferred from files until events arrive.

## Alternatives Considered

- **Opt-in only.** Nothing reads cmux's files until the person asks. Rejected: it slows getting value at work, and the files are read-only metadata with an off switch.
- **Automatic with no off switch.** Rejected: it leaves no way to opt out of reading another app's private files.
- **cmux's per-session record** (`~/.cmuxterm/claude-hook-sessions.json`). It holds only the last hook event per session (`running`, `idle`, `unknown`), so it is coarser than the stream and gives no awaiting state.
- **`cmux events` over the socket.** Live and structured, but it only answers processes started inside cmux, which would tie live status to how Moon Base was started.
- **Install Moon Base's own hooks at work.** Not available there.

## Links

- `docs/features/moon-base/spec.md` (AC14)
- `docs/brainstorms/2026-09-26-001-v2-roadmap-idea.md`
- `docs/decisions/2026-09-26-live-status-through-a-shared-hook-and-events-file.md`
