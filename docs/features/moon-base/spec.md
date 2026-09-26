---
title: Moon Base
status: active
created: 2026-09-25
updated: 2026-09-26
tags:
  - visualization
  - claude-code
  - codex
  - local-first
related_decisions:
  - docs/decisions/2026-09-26-fork-bot-crossing-and-trim-to-two-tools.md
  - docs/decisions/2026-09-26-opt-in-hook-installer-is-the-only-config-writer.md
  - docs/decisions/2026-09-26-open-sessions-through-url-schemes-only.md
  - docs/decisions/2026-09-26-live-status-through-a-shared-hook-and-events-file.md
  - docs/decisions/2026-09-26-original-bot-from-cc0-art-rover.md
  - docs/decisions/2026-09-26-terminal-handoff-copy-command-and-opt-in-launcher.md
---

# Moon Base

## Intent

Give a developer running many Claude Code and Codex sessions at once a single, glanceable, local view of all of them: a lunar colony where each repo is a hex plot and each session is a bot. At a glance you can tell which sessions are working, which are waiting on you, which errored, and which have gone quiet, and you can jump into a session or start a new one straight from the map.

Moon Base is a fork of [Bot Crossing](https://github.com/Station-Sciences/bot-crossing) (MIT). It keeps that project's core model (read-only adapters, one bot per session, one hex zone per repo, local-only server) and changes four things:

1. Only Claude Code and Codex are supported.
2. It has its own moon-base theme and original bot identity.
3. Status can be live via opt-in hooks instead of only being inferred from session files.
4. Clicking a bot opens or starts sessions through the tools' own URL schemes, or, when the person chooses, hands the matching terminal command to their terminal.

## Users

- A developer on one machine running several Claude Code and Codex sessions in parallel across multiple repos. macOS is the primary platform.
- The same developer on a machine where the Claude and Codex desktop apps are not installed and sessions run in a terminal (cmux is the one tested). The colony still works as a viewer there, and the terminal hand-off (AC13) replaces the URL schemes.

## Current Behavior

Built and covered by tests (see the plan's traceability table): both tools' sessions appear as bots on hex plots per repo; opening a thread and starting a session go through the tools' URL schemes only, on ids and folders the server found itself; live status through an opt-in hook installer, with a fallback to the session files; the bot is an original design (Rover by default, with `?look=lantern` and `?look=dish`) on CC0 art with credits and attribution recorded; a setting chooses whether Open and Start-session use the desktop app (the default), copy a terminal command, or, when the server was started with `MOON_BASE_TERMINAL=cmux`, open a cmux workspace (AC13, covered by tests with the launcher faked).

Not yet verified against the real tools: the permission signals (`PermissionRequest` and `Notification`) in interactive and desktop sessions, live hooks end to end in real Claude Code and Codex sessions, `claude://code/new?folder=` in the Claude window, and the cmux launcher against a running cmux (see Still open). Nothing is committed yet, and human review is not configured.

## Key Flows

### F1. See the colony

1. The user starts Moon Base locally and opens it in a browser.
2. Sessions from Claude Code (`~/.claude/projects/<encoded-path>/<uuid>.jsonl`) and Codex (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) appear, one bot per session, grouped into one hex zone per repo.
3. Each bot shows its state: errored, running, PR merged, awaiting input, dormant, or idle.

### F2. Turn on live status (opt-in)

1. The user runs the hook install command.
2. Moon Base shows the exact change it would make to each tool's config (Claude Code settings, Codex config) and waits for explicit confirmation.
3. On yes, it adds only clearly marked Moon Base entries and leaves everything else untouched.
4. For Codex, the user then reviews and trusts the new hook through Codex's own hook review (`/hooks`), because Codex will not run an untrusted hook.
5. From then on, state changes reach the map within seconds. The user can run the uninstall command to remove exactly those entries.

### F3. Open or resume a session

1. The user clicks a bot (or presses Enter on the selected one).
2. Depending on the `Open sessions with` setting, Moon Base:
   - **Desktop app** (default): opens that session in its own desktop app or CLI handler through the tool's URL scheme.
   - **Copy terminal command**: copies one shell line (`cd '<folder>' && claude --resume <id>`, or `codex resume <id>`) and says so. The user pastes it into any terminal.
   - **Terminal (cmux)**, offered only when the server was started with `MOON_BASE_TERMINAL=cmux`: opens a cmux workspace in the session's folder that runs that same command.

### F4. Start a session in a repo

1. The user picks a repo's zone and chooses to start a new session, and chooses which tool.
2. Moon Base does the same three things as in F3, with the bare tool (`claude` or `codex`) in the repo's folder, or the tool's URL scheme in the default mode.

## Acceptance Criteria

Coverage marker convention will follow `docs/standards/` once standards exist.

- **AC1. Both tools discovered.** Given sessions exist for both tools, each appears as exactly one bot with a unique, prefixed ID (`claude-code:<uuid>`, `codex:<uuid>`). Malformed session files are skipped without failing the scan.
- **AC2. Status precedence.** A session's shown state follows: errored, then running, then PR merged, then awaiting input, then dormant (more than three days of inactivity), then idle. Dormant and idle bots carry no badge.
- **AC3. Read-only toward session data.** Moon Base never modifies, archives or deletes a tool's session data. Its own state file is the only file it writes routinely. The only other permitted writes are hook entries in tool configs, and only after the explicit confirmation in AC5.
- **AC4. Local-only.** The server binds to loopback by default and validates Host and Origin. There are no external network calls, telemetry or accounts.
- **AC5. Hooks are opt-in and reversible.** Nothing edits a tool config during install, first run or app start. The install command shows the exact per-tool diff, requires confirmation, and writes only marked Moon Base entries. The uninstall command removes only those entries. A declined or failed install leaves configs byte-for-byte unchanged. Existing user hooks and Codex's existing `notify` setting are never modified, and Codex hook trust is never bypassed.
- **AC6. Live status.** With hooks installed, transitions show on the map within about three seconds (the page's poll interval while hooks are reporting), per tool:
  - Claude Code: running when a prompt is submitted or tools are executing, awaiting input on a permission or input notification, finished when the turn stops, and errored when the turn ends on an API failure.
  - Codex: running when a prompt is submitted or tools are executing, awaiting input on a permission request, and finished when the turn stops. Codex has no equivalent failure event, so errored stays inferred from session files.
- **AC7. Graceful fallback.** Without hooks, or if hook events stop arriving, status falls back to file-based inference with no error state and no user action.
- **AC8. Control via URL schemes by default.** With the default `Open sessions with` setting, clicking a bot or starting a session uses the tool's URL scheme. The server exposes only fixed actions on known thread and repo IDs, never spawns a process from request-controlled data, and has no arbitrary-command path. A session with no valid open target is shown as not openable, with a reason. When opening would create a new desktop session rather than reopen an existing one (a CLI-only Claude Code session is imported this way), the UI says so before the user commits. The only processes the server ever starts are the OS opener (this criterion), the Linux scheme probe, and the terminal launcher of AC13 when it is enabled.
- **AC9. Own identity.** The name, palette, UI and bot character are Moon Base's own. The name "Bot Crossing" and upstream's crew character are not used as this product's identity. The bot character is original.
- **AC10. Art licensing.** Third-party art is limited to CC0 packs taken from their original sources and credited in the repo.
- **AC11. Attribution and license.** Upstream's MIT license text and copyright notice are retained. The README says the project is based on Bot Crossing and is not endorsed or maintained by it. The upstream commit that was imported is recorded.
- **AC12. Scope of adapters.** Only Claude Code and Codex adapters ship. The adapter interface stays so another tool can be added later without touching the renderer.
- **AC13. Terminal hand-off, opt-in.** The `Open sessions with` setting (default: desktop app) can be changed to copy a terminal command, or to a terminal launcher. Both work only on a thread or repo the server found in its own scan, and neither takes a command, argument, folder or launcher from a request.
  - **The command.** For a thread it is `cd '<folder>' && claude --resume <cli id>` or `cd '<folder>' && codex resume <id>`. For a new session it is `cd '<folder>' && claude` or `cd '<folder>' && codex`. It is built from tokens the adapter supplies, and every token must match `[A-Za-z0-9._-]`, so it carries no shell syntax. The ids are the UUIDs the adapters already pattern-check. The folder is single-quoted for a POSIX shell, and a folder containing a control character is refused. The line is POSIX shell, so this is macOS and Linux only.
  - **Copy.** The server returns the line and the page copies it. The server starts nothing.
  - **Launcher.** Enabled only when whoever starts the server sets `MOON_BASE_TERMINAL=cmux` in its environment. The value is read from the server's environment and never from a request, and any other value enables nothing. The server then runs `cmux new-workspace --cwd <folder> --command <tokens> --focus true` once, as an argument list with no shell. The folder is its own argument and never appears in the `--command` text. Only the `cmux` command found on the server's `PATH` is run.
  - **Failures.** A launch that fails is reported to the page with a fixed message (`cmux` not on the path, refused because Moon Base was not started inside a cmux terminal, no answer in time), never with the tool's own output. A thread with no session id or no folder on record is reported as such.
  - **No desktop app needed.** Copy works with any terminal and no desktop app installed.

## Boundaries and Non-Goals

- Other tools (Cursor, OpenCode, Antigravity, Hermes, Kilo Code and others).
- Writing to, archiving or otherwise mutating tool session state.
- The server launching a terminal or running a command from anything a request says. The only exception is the AC13 launcher: one named terminal, enabled from the server's environment, given a command built from adapter tokens. Terminals other than cmux (Terminal.app, iTerm2, Ghostty, tmux) and Windows shells are not supported yet.
- Codex's `notify` setting (turn-end only, and a single slot already in use on this machine), and any bypass of Codex hook trust.
- Sending input to or steering a running session from the map.
- Remote, multi-machine or shared-network use, authentication, and cloud sync.
- Automatic tracking of upstream. Upstream changes are brought in by manual cherry-pick.
- Analytics such as cost, token usage or leaderboards.

## Open Questions / TODOs

### Spike findings (2026-09-25 and 26; documentation plus live checks on this machine)

- **Hook events, observed.** Claude Code 2.1.159: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `StopFailure` (fired on an auth failure, with `error` and `last_assistant_message`) and `SessionEnd` all fired with project-scoped hooks, both in headless runs and when the desktop app imported a session (`SessionStart`, source `resume`). Codex 0.157.1 (upgraded from 0.135.0 mid-spike): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` and `SessionEnd` fired once the hooks were trusted. Codex `notify` only fires at turn end and is not used. AC6 reflects this, including the Codex errored carve-out.
- **Session IDs.** A hook's `session_id` equals the transcript UUID for Claude Code and the rollout UUID for Codex. An imported Claude desktop session gets the ID `local_<CLI UUID>` plus a `cliSessionId` link. The first 8 characters of Codex UUIDv7 IDs repeat across sessions within minutes, so full IDs are always used.
- **Codex hook trust.** Each hook is trusted as `<hooks.json path>:<event>:<group index>:<handler index>` plus a hash of its definition. Untrusted hooks are skipped silently, even in a trusted project. Changing only the script's contents did not require re-trust. A user-level `hooks.json` next to `[hooks.state]` in `config.toml` produced no merge warning. Codex clamps `SessionEnd` and `Interrupt` timeouts to 3 seconds and prints two visible lines per hook per event.
- **Hook cost and environment.** About 10 ms of Node boot plus about 2 ms of work per event. A bare `node` command resolved in every environment tried, including the desktop-app import path, but it depends on the user's Node install.
- **Tool configs are written by others.** Codex rewrites `~/.codex/config.toml` on its own: its desktop app added a project entry during the spike, and Codex added a trust entry for the scratch folder the first time it ran there. The installer must not depend on editing that file.
- **URL schemes, observed.** `claude://` is registered by Claude.app and `codex://` by ChatGPT.app. `codex://threads/new?path=<dir>` opened a new chat in that folder and created no thread. `codex://threads/<id>` opened a thread created from the CLI. `claude://resume?session=<cli id>` imported a CLI transcript as a new desktop record. `claude://claude.ai/epitaxy/<desktop id>` focused it, seen as an updated `lastFocusedAt` in the record. `claude://code/new?folder=<dir>` created no record and its window was not observed, because Claude cannot be given control of its own window.
- **Storage.** `node:sqlite` opens `~/.codex/state_5.sqlite` read-only on Node 22.22 with no flag, printing only an experimental warning. Claude desktop records are in `~/Library/Application Support/Claude/claude-code-sessions`.
- **cmux 0.64.25, observed (2026-09-26, read-only: help, docs, `ping`, `version`).** It is a terminal, not a URL-scheme handler: its registered schemes are `http`, `https`, `ssh` and `cmux`, and `cmux` is registered under the name `com.cmuxterm.app.auth`. It is driven by a CLI that talks to a Unix socket. `cmux new-workspace` takes `--cwd <path>` and `--command <text>` ("run this as the new terminal's initial command") and `--focus <true|false>` (default false), and targets "the caller's window". By default the socket only accepts processes started inside cmux: `cmux ping` from outside exits 1 with `Access denied - only processes started inside cmux can connect`. The `cmux` binary is inside the app bundle (`/Applications/cmux.app/Contents/Resources/bin/cmux`) and was not on this machine's plain `PATH`. Nothing was created in the running cmux.

### Still open

- **cmux launcher, end to end.** Checked so far (2026-09-26): with the dev server started outside cmux and the real `cmux` binary on its `PATH`, the page's Open in Terminal mode was refused by cmux and showed the fixed "not started inside a cmux terminal" message, and copy mode put the exact command on the clipboard. Not yet run successfully against a live cmux, because that needs Moon Base started from inside a cmux terminal (manual check M6). To check: whether `cmux` is on `PATH` there, whether `--command` runs in a shell that has `claude` and `codex` on its `PATH` (an nvm-installed `claude` may not be found if the initial command skips the login shell), whether `--focus true` also brings the cmux window forward, and what the workspace does when `claude` exits.

- **Permission signals (blocking for the live-status unit).** `PermissionRequest` and `Notification` (Claude Code) and `PermissionRequest` (Codex) were not observed, because non-interactive runs never reach a permission prompt. Verify them in an interactive session for each tool and, for Claude Code, in a desktop-app session. Where a tool does not signal them, "awaiting input" for that tool falls back to file inference, as Codex errored does.
- **Claude new-session URL.** `claude://code/new?folder=` needs a person to look at the Claude window and confirm it opens a new session in that folder.

Decided in the plan rather than by the spike: hook transport (a shared command hook writing an events file). Resolved by the spike: whether `codex://threads/<id>` opens a CLI-created thread (it does).

### Deferred

- Mascot design, planet names, and sound.
- Whether Linux and Windows stay supported. Default is macOS-first, with inherited code paths kept but untested.
- Cadence for reviewing upstream changes.
- License for Moon Base's own additions. Default is to continue under MIT.
- Terminal launchers other than cmux (Terminal.app, iTerm2, Ghostty, tmux), and Windows shells. The launcher table in `server/lib/terminal.mjs` is where they would go.

## Decision Links

- [Fork Bot Crossing and trim it to Claude Code and Codex](../../decisions/2026-09-26-fork-bot-crossing-and-trim-to-two-tools.md)
- [The opt-in hook installer is the only thing that writes a tool's config](../../decisions/2026-09-26-opt-in-hook-installer-is-the-only-config-writer.md)
- [Sessions open through URL schemes only, and the server starts no other process](../../decisions/2026-09-26-open-sessions-through-url-schemes-only.md) (superseded by the terminal hand-off decision below)
- [Terminal hand-off: a copied command, and an opt-in cmux launcher](../../decisions/2026-09-26-terminal-handoff-copy-command-and-opt-in-launcher.md)
- [Live status comes from one shared hook that appends to a private events file](../../decisions/2026-09-26-live-status-through-a-shared-hook-and-events-file.md)
- [The bot is an original design on CC0 art, and the shipped look is Rover](../../decisions/2026-09-26-original-bot-from-cc0-art-rover.md)
