---
title: cmux's session records and event stream exist only while its Claude Code integration is on
scope: repo
created: 2026-09-26
trigger: post-completion-feedback
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-resume-without-cmux-hooks
tags:
  - cmux
  - hooks
  - claude-code
  - moon-base
---

# cmux's session records and event stream exist only while its Claude Code integration is on

## Lesson

Anything Moon Base reads from cmux about Claude sessions depends on cmux's own Claude Code integration, which can be off. It is a cmux setting (`claudeCodeIntegration`, on by default), and when it is off cmux's `claude` wrapper is inert: no `--settings`, so no hooks fire back into cmux. Observed on cmux 0.64.25:

- `~/.cmuxterm/claude-hook-sessions.json` is written by those hooks and is the only store `cmux sessions` reads for Claude (`stores` in its JSON says so). With the integration off it is empty or missing, and `cmux sessions` answers with nothing.
- `~/.cmuxterm/workstream.jsonl`, the live-status stream, comes from the same hooks.
- The wrapper's master opt-out is `CMUX_CLAUDE_HOOKS_DISABLED=1`.

Claude's own record of its live processes, `~/.claude/sessions/<pid>.json`, does not depend on cmux. Its `entrypoint` says who started the process: `cli` for a terminal, `claude-desktop` for the desktop app, which keeps idle sessions warm for days.

## Applies When

- Adding anything that reads cmux's records about Claude, or reasoning about why it is empty on some machine.
- Deciding whether a process "is running a session": the desktop app's warm processes are not the same as a terminal session someone is using.

## Do Instead

- Treat cmux's records as one source that can be silently empty, never as the only one. Give a check that must not miss a running session a second source that needs no hook.
- When a machine reports "nothing found" for cmux, ask whether its Claude Code integration is on before assuming an install problem, and make the doctor say so.
- The assumption that cmux's hooks fire at work (plan, manual check M7) was wrong there; the person confirmed the integration is off on that machine.

## Evidence

- The work machine printed "cmux stream: not found" and every Resume opened a second workspace; the person then confirmed the integration is off there. On the personal machine `cmux sessions` names `claude-hook-sessions.json` as its single store, and the wrapper's opt-out was read from cmux's own script.
