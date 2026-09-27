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
  - docs/decisions/2026-09-26-live-status-from-cmux-event-stream-metadata-only.md
  - docs/decisions/2026-09-26-moonbase1-starts-in-process-and-finds-copies-by-asking.md
  - docs/decisions/2026-09-26-open-sessions-with-defaults-to-automatic.md
---

# Moon Base

## Intent

Give a developer running many Claude Code and Codex sessions at once a single, glanceable, local view of all of them: a lunar colony where each repo is a hex plot and each session is a bot. At a glance you can tell which sessions are working, which are waiting on you, which errored, and which have gone quiet, and you can jump into a session or start a new one straight from the map.

Moon Base is a fork of [Bot Crossing](https://github.com/Station-Sciences/bot-crossing) (MIT). It keeps that project's core model (read-only adapters, one bot per session, one hex zone per repo, local-only server) and changes five things:

1. Only Claude Code and Codex are supported.
2. It has its own moon-base theme and original bot identity.
3. Status can be live via opt-in hooks instead of only being inferred from session files.
4. Clicking a bot opens or starts sessions through the tools' own URL schemes, or, when the person chooses, hands the matching terminal command to their terminal.
5. Status can also be live with no hooks at all, from what cmux and Claude Code already record about running sessions, and starting Moon Base is one command, `moonbase1`.

Change 5 is the first slice of v2. Its source and the rest of the v2 ideas, which are not specified yet, are in [the v2 brainstorm](../../brainstorms/2026-09-26-001-v2-roadmap-idea.md).

## Users

- A developer on one machine running several Claude Code and Codex sessions in parallel across multiple repos. macOS is the primary platform.
- The same developer on a machine where the Claude and Codex desktop apps are not installed and sessions run in a terminal (cmux is the one tested). The colony still works as a viewer there, and the terminal hand-off (AC13) replaces the URL schemes. At work this is the usual case, with no access to hooks: cmux itself shows agent status there, so the records it keeps are a live source (AC14).

## Current Behavior

Built and covered by tests (see the plan's traceability table): both tools' sessions appear as bots on hex plots per repo; opening a thread and starting a session go through the tools' URL schemes only, on ids and folders the server found itself; live status through an opt-in hook installer, with a fallback to the session files; the bot is an original design (Rover by default, with `?look=lantern` and `?look=dish`) on CC0 art with credits and attribution recorded; a setting chooses whether Open and Start-session use the desktop app (the default), copy a terminal command, or, when the server was started with `MOON_BASE_TERMINAL=cmux`, open a cmux workspace (AC13, covered by tests with the launcher faked).

The cmux launcher was run against a live cmux on 2026-09-26 and works, including the already-open check and bringing cmux forward (see Still open for what is left). AC14 (live status without hooks) and AC15 (easy start, `moonbase1`) are built and covered by tests, and were run for real on the personal machine on 2026-09-26: the doctor against the real files, a real start (it built the page, picked a port, and a second start reused the first), a rebuild when the source changed, the launcher turning on with cmux's environment variables simulated (it was not run inside a real cmux terminal), and the Live chip in the real page. They have not been run at work yet (see Still open).

Not yet verified against the real tools: the permission signals (`PermissionRequest` and `Notification`) from Moon Base's own hooks in interactive and desktop sessions, live hooks end to end in real Claude Code and Codex sessions, and `claude://code/new?folder=` in the Claude window. The work is committed and pushed to `main`. Human review is not configured, and no review gate was run.

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

### F5. Live status without installing hooks

1. The user runs Claude Code sessions in cmux. Nothing is installed and nothing in any config changes.
2. Moon Base notices cmux's records on its own. The Live chip names cmux while it is reporting.
3. A bot turns to running when a prompt is sent or tools run, to awaiting input when the session asks for a permission or asks a question, and to finished when the turn stops, within about three seconds.
4. If cmux is not installed, stops reporting, or the person switched the source off, status falls back to the session files with no error (AC7).

### F6. Start Moon Base

1. In a terminal, ideally a cmux terminal, the user runs `moonbase1`.
2. Moon Base makes sure a build is ready, starts on a free port (or says a copy is already running and uses that one), and opens the page.
3. Inside cmux the terminal launcher is on and, until the person picks a setting, `Open sessions with` starts on Terminal. Outside cmux the launcher is off and copy mode still works.

## Acceptance Criteria

Coverage marker convention will follow `docs/standards/` once standards exist.

- **AC1. Both tools discovered.** Given sessions exist for both tools, each appears as exactly one bot with a unique, prefixed ID (`claude-code:<uuid>`, `codex:<uuid>`). Malformed session files are skipped without failing the scan.
- **AC2. Status precedence.** A session's shown state follows: errored, then running, then PR merged, then awaiting input, then dormant (more than three days of inactivity), then idle. Dormant and idle bots carry no badge.
- **AC3. Read-only toward session data.** Moon Base never modifies, archives or deletes a tool's session data. Its own state file is the only file it writes routinely. The only other permitted writes are hook entries in tool configs, and only after the explicit confirmation in AC5.
- **AC4. Local-only.** The server binds to loopback by default and validates Host and Origin. There are no external network calls, telemetry or accounts.
- **AC5. Hooks are opt-in and reversible.** Nothing edits a tool config during install, first run or app start. The install command shows the exact per-tool diff, requires confirmation, and writes only marked Moon Base entries. The uninstall command removes only those entries. A declined or failed install leaves configs byte-for-byte unchanged. Existing user hooks and Codex's existing `notify` setting are never modified, and Codex hook trust is never bypassed.
- **AC6. Live status.** With hooks installed, or with another live source reporting (AC14), transitions show on the map within about three seconds (the page's poll interval while a live source is reporting), per tool:
  - Claude Code: running when a prompt is submitted or tools are executing, awaiting input on a permission or input notification, finished when the turn stops, and errored when the turn ends on an API failure.
  - Codex: running when a prompt is submitted or tools are executing, awaiting input on a permission request, and finished when the turn stops. Codex has no equivalent failure event, so errored stays inferred from session files.
- **AC7. Graceful fallback.** Without hooks or any other live source, or if their events stop arriving, status falls back to file-based inference with no error state and no user action.
- **AC8. Control via URL schemes by default.** With the default `Open sessions with` setting, clicking a bot or starting a session uses the tool's URL scheme. The server exposes only fixed actions on known thread and repo IDs, never spawns a process from request-controlled data, and has no arbitrary-command path. A session with no valid open target is shown as not openable, with a reason. When opening would create a new desktop session rather than reopen an existing one (a CLI-only Claude Code session is imported this way), the UI says so before the user commits. The only processes the server ever starts are the OS opener (this criterion), the Linux scheme probe, and the terminal launcher of AC13 when it is enabled.
- **AC9. Own identity.** The name, palette, UI and bot character are Moon Base's own. The name "Bot Crossing" and upstream's crew character are not used as this product's identity. The bot character is original.
- **AC10. Art licensing.** Third-party art is limited to CC0 packs taken from their original sources and credited in the repo.
- **AC11. Attribution and license.** Upstream's MIT license text and copyright notice are retained. The README says the project is based on Bot Crossing and is not endorsed or maintained by it. The upstream commit that was imported is recorded.
- **AC12. Scope of adapters.** Only Claude Code and Codex adapters ship. The adapter interface stays so another tool can be added later without touching the renderer.
- **AC13. Terminal hand-off, opt-in.** The `Open sessions with` setting (default: desktop app) can be changed to copy a terminal command, or to a terminal launcher. Both work only on a thread or repo the server found in its own scan, and neither takes a command, argument, folder or launcher from a request.
  - **The command.** For a thread it is `cd '<folder>' && claude --resume <cli id>` or `cd '<folder>' && codex resume <id>`. For a new session it is `cd '<folder>' && claude` or `cd '<folder>' && codex`. It is built from tokens the adapter supplies, and every token must match `[A-Za-z0-9._-]`, so it carries no shell syntax. The ids are the UUIDs the adapters already pattern-check. The folder is single-quoted for a POSIX shell, and a folder containing a control character is refused. The line is POSIX shell, so this is macOS and Linux only.
  - **Copy.** The server returns the line and the page copies it. The server starts nothing.
  - **Launcher.** Enabled only when whoever starts the server sets `MOON_BASE_TERMINAL=cmux` in its environment. The value is read from the server's environment and never from a request, and any other value enables nothing. Before opening a thread this way, the server asks cmux's own record — `cmux sessions --agent <claude|codex> --session <id> --json`, which needs no running socket — whether that exact session is already open; if it is, nothing new is started and the page is told it is already open. Otherwise the server runs `cmux new-workspace --cwd <folder> --command <tokens> --focus true` once, as an argument list with no shell. The folder is its own argument and never appears in the `--command` text. Only the `cmux` command found on the server's `PATH` is run. A new session has no id to check, so it is never held back this way. Either way — a fresh launch or a skipped duplicate — the server then best-effort runs `open -a cmux` (macOS only) to bring the cmux application itself forward, since nothing in cmux's own CLI raises the application over whatever else has focus; a failure here changes nothing about the answer already decided.
  - **Failures.** A launch that fails is reported to the page with a fixed message (`cmux` not on the path, refused because Moon Base was not started inside a cmux terminal, no answer in time), never with the tool's own output. A thread with no session id or no folder on record is reported as such.
  - **No desktop app needed.** Copy works with any terminal and no desktop app installed.
- **AC14. Live status without hooks.** Moon Base uses what cmux and Claude Code already record about running sessions as live sources, so status is live at work with no Moon Base hooks installed. Decisions and alternatives: `docs/decisions/2026-09-26-live-status-from-cmux-event-stream-metadata-only.md`.
  - **Sources, layered.** Signals from cmux's event stream (`~/.cmuxterm/workstream.jsonl`), from Claude Code's own live-session marker (`~/.claude/sessions/<pid>.json`, its `status`), and from Moon Base's own hooks (AC6, where installed) all lay over what the adapters read from files, exactly as hook events do today. A signal colours a session the scan already found and never creates a bot. A signal for a session nobody has scanned is held briefly, then dropped. Every state expires and hands the session to the next source or to the files (AC7).
  - **Mapping.** From cmux's stream: `userPrompt`, `toolUse` and `toolResult` mean running; `permissionRequest` and `question` mean awaiting input; `stop` means finished; `sessionEnd` forgets the session; `sessionStart` changes nothing. From Claude's marker: `busy` means running, and `idle` adds no state of its own. `question` means awaiting input: its payload is a pending request like a permission (cmux marks both `status: pending`). That is read from the observed rows and still to be confirmed at work.
  - **Metadata only.** From a cmux row Moon Base reads the event kind, the session id (encoded in the row's `workstreamId`), the folder and timestamps, and nothing else. No other field of a row, including message content, tool input or prompt text, is ever kept, logged, served to the page or written to any file.
  - **Read-only, no socket.** Nothing is written to cmux's files or to any tool config, and no cmux socket connection is used, so it works when Moon Base was started outside cmux.
  - **Automatic, visible, easy off.** The cmux source is used whenever its files exist. The Live chip names cmux while it is reporting and shows it as not reporting when it is not. `MOON_BASE_CMUX_STATUS=off` (also `0`, `false` or `no`) turns it off, and then cmux's files are never read and the chip does not name cmux. `MOON_BASE_CMUX_DIR` points at a different folder than `~/.cmuxterm`, for tests and unusual installs.
  - **Tools.** Claude Code first. Codex is best-effort: whatever cmux reports for it is used the same way, and anything it does not report stays inferred from files.
  - **Tolerant.** Unknown event kinds, a changed row shape, a missing, truncated, rotated or unreadable file, and cmux not being installed are all ignored without an error, and the chip shows cmux as not reporting.
  - **Examples.**
    - At work with no Moon Base hooks installed, sending a prompt in a cmux Claude session turns its bot to running within about three seconds.
    - When Claude asks for a permission the bot shows awaiting input. After approval and the tool result it is running again, and at stop it is finished.
    - With cmux absent, its files missing or unreadable, or the stream empty, nothing errors and the files decide.
    - With the off switch set, cmux's files are never read and the chip does not name cmux.
    - A cmux event for a session Moon Base has not scanned is held briefly, then dropped, and creates no bot.
    - Fixture rows whose content fields hold sentinel text never reach the page, the API, logs or any file Moon Base writes. A test proves it.
    - Unknown kinds or a changed row shape are ignored, the chip shows cmux as not reporting, and `moonbase1 doctor` (AC15) says why.
- **AC15. Easy start.** One command, `moonbase1`, starts Moon Base.
  - **The command.** With no arguments it starts Moon Base. `install-hooks`, `uninstall-hooks` and `hooks-status` (AC5) become subcommands of the same command, and `npm run moon-base -- <command>` keeps working. It is put on the PATH by a one-time `npm link`, or by an alias where that is blocked (see Open Questions). The name was chosen over `starcommand`, which does not say Moon Base and is also the name of Disney's Star Command, at odds with AC9.
  - **Fast.** It serves a ready build and builds only when the build is missing or older than the source.
  - **cmux aware.** Inside a cmux terminal, recognised from cmux's own environment variables (`CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID` and `CMUX_SOCKET_PATH`), it starts the server with the AC13 terminal launcher on, as if `MOON_BASE_TERMINAL=cmux` had been set in the server's environment, so the launcher is still chosen by the environment and never by a request. Outside cmux it says the launcher is off, and copy mode still works.
  - **Port and page.** It uses a free port when the default is taken, or says a copy is already running and uses that one instead of starting a second server, and then opens the page.
  - **First-run default.** When the server has a launcher on and the person has not yet chosen an `Open sessions with` setting, the page starts on Terminal instead of Desktop app. Once the person chooses, that choice stays, whatever the server detects.
  - **Explicit wins.** An explicit environment variable or setting overrides every automatic choice above.
  - **Doctor, minimal.** `moonbase1 doctor` reports what start decides: inside cmux or not, launcher on or off, the port, whether the build is fresh, and for each live source (AC14) whether it is reporting and, if not, why. A fuller doctor is not specified yet.
  - **Examples.**
    - In a fresh cmux terminal, `moonbase1` starts Moon Base and opens the page with the launcher on and no env var set, and with a build already present it is ready in seconds.
    - From a normal terminal it starts fine, says the launcher is off, and copy mode still works.
    - With the default port taken it starts on a free port, and if a Moon Base is already running it says so and uses it.
    - On first load inside cmux with no stored setting, `Open sessions with` reads Terminal. After the person picks another setting, that choice stays.

## Boundaries and Non-Goals

- Other tools (Cursor, OpenCode, Antigravity, Hermes, Kilo Code and others).
- Writing to, archiving or otherwise mutating tool session state.
- The server launching a terminal or running a command from anything a request says. The only exception is the AC13 launcher: one named terminal, enabled from the server's environment, given a command built from adapter tokens. Terminals other than cmux (Terminal.app, iTerm2, Ghostty, tmux) and Windows shells are not supported yet.
- Codex's `notify` setting (turn-end only, and a single slot already in use on this machine), and any bypass of Codex hook trust.
- Sending input to or steering a running session from the map.
- Keeping, logging, serving or showing message content, tool input or prompt text taken from cmux's event stream (AC14). Only kind, session id, folder and timestamps are read.
- Always-on start: a login item or a menu-bar app. Easy start (AC15) is a command run from a terminal.
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
- **cmux launcher used from inside cmux, observed (2026-09-26, on the user's own resume click).** The command reached the right folder and the right session id: `claude --resume <id>`, `cwd` the repo, transcript written to the expected `~/.claude/projects/<encoded-path>/<id>.jsonl`. cmux itself wraps a bare `claude`/`codex` invocation with its own flags (a generated `--settings` file and an `--mcp-config` adding its own `cmux-cua` MCP server for its computer-use feature) — harmless to the session id and folder Moon Base asked for, but worth knowing before reading a live process list and expecting to see the plain command back. `cmux sessions --agent <agent> --session <id> --json` (no socket needed) returned that session's `pid`, `workspace_id` and `stored_pid_exists: true` while it was still running, which is what the already-open check above reads. **Real problem found:** clicking Resume on a thread already open in cmux started a second `claude --resume` on the same id, in a new workspace, rather than reusing or focusing the one already running — fixed by the already-open check above. **Not yet fixed:** there is no way to focus cmux's *existing* workspace from here yet, only to skip opening a second one; the person has to switch to it themselves. Whether `cmux` was on the launching terminal's `PATH` and whether `claude`/`codex` were found by the `--command` shell were not reported as problems in this run.

- **cmux's event stream and Claude's live marker, observed (2026-09-26, read-only, on the personal machine).** `~/.cmuxterm/workstream.jsonl` is an append-only stream whose rows have `kind` (`sessionStart`, `userPrompt`, `toolUse`, `toolResult`, `permissionRequest`, `question`, `stop`, `sessionEnd`), `source` (`claude` or `codex`), `cwd`, `createdAt`, `updatedAt`, a `payload`, and a `workstreamId` of the form `cmux-feed-v1:<base64 source>:<base64 session id>`. It held 40 rows over about 65 minutes, 38 from Claude and 2 from Codex (both `sessionStart`), and decoded session ids joined to a real transcript for 4 of 5 sessions. Rows carry message content in `payload`. `~/.cmuxterm/events.jsonl` (356 rows, with `agent.hook.*` names and a `notification` category) was not examined further. `~/.cmuxterm/claude-hook-sessions.json` keeps only the last hook event per session (`agentLifecycle` running, idle or unknown), which is coarser, so it is not planned as a source. Claude's own marker `~/.claude/sessions/<pid>.json` has `status` (`busy` or `idle`) and `statusUpdatedAt`; the adapter reads the file only to check the process is alive and does not use `status` today. A process started by cmux carries `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID` and `CMUX_SOCKET_PATH` in its environment. The stream held real `permissionRequest` (2) and `question` (1) events from interactive Claude sessions, the first real-world evidence for the permission-signal question, for Claude in cmux. The person reports cmux shows agent status for Claude sessions on the work machine, but the stream file itself has not been observed there.

### Still open

- **Live status without hooks (AC14).** Built. Settled in `docs/features/moon-base/plan.md` (D14 to D19) on 2026-09-26:
  - **Q1, settled on the data.** `question` means awaiting input. What is left is what Codex rows look like beyond `sessionStart`; anything unknown is ignored, and any Codex row of a known kind is used.
  - **Q2, mostly settled.** On start Moon Base replays the last 6 hours or 1 MiB, tolerates truncation, replacement and partial lines, and accepts long rows. `cmux feed clear` shows the history is user-clearable. cmux's own rotation policy is unknown and is to be observed at work.
  - **Q3, settled.** `MOON_BASE_CMUX_STATUS=off` (see AC14).
  - **Still open:** the stream has not been observed on the work machine. Check there that it fills while a Claude session runs in cmux, which is also the check that cmux's hooks fire under that machine's settings (plan, manual check M7). On the personal machine its `workstream.jsonl` was present and being read, with the last row hours old.
- **Easy start (AC15).** Built.
  - **Q4, mostly settled.** "The build is older than the source" is judged by modification times against `dist/index.html`, and an already-running Moon Base is found by asking each candidate port for its identity (plan, D21 and D22).
  - **Still open:** how `moonbase1` gets onto the PATH at work, `npm link` or a shell alias if global links are blocked there (plan, manual check M8).
- **cmux launcher, end to end.** Now run successfully against a live cmux (see the spike findings above): the command reached the right folder and session, and the duplicate-open bug found in that run is fixed. Confirmed on that same run: `--focus true` does **not** bring the cmux application itself to the OS foreground — it only selects the workspace inside cmux's own window, which stays wherever it already was (behind the browser, in the report that led to this finding). `open -a cmux` after the launch is the fix; it runs without error, but has not yet been confirmed by eye to actually raise the window (the check that found the gap was a report of "nothing visibly happens," not a screen-by-screen comparison). Still to check: whether `open -a cmux` visibly raises the window every time, and what the workspace does when `claude` or `codex` exits.
- **Focusing an already-open session's own workspace.** The already-open check stops a second launch and brings the cmux *application* forward, but does not select that specific *workspace* within it if another one is showing — `cmux sessions --json` names its `workspace_id`, but no command to switch to a workspace by id was found among cmux's documented actions (`workspace-action`'s action list has no "focus" or "select"; only `focus-window`, for whole windows, and `tab-action`, for tabs within the caller's own workspace). Worth another look once the person has a concrete need for it.

- **Permission signals (blocking for the live-status unit).** `PermissionRequest` and `Notification` (Claude Code) and `PermissionRequest` (Codex) were not observed from Moon Base's own hooks, because non-interactive runs never reach a permission prompt. Verify them in an interactive session for each tool and, for Claude Code, in a desktop-app session. Where a tool does not signal them, "awaiting input" for that tool falls back to file inference, as Codex errored does. Partly answered on 2026-09-26: cmux's stream showed real `permissionRequest` and `question` events from interactive Claude Code sessions (see the spike findings), which covers Claude Code in cmux but not Moon Base's own hooks or Codex.
- **Claude new-session URL.** `claude://code/new?folder=` needs a person to look at the Claude window and confirm it opens a new session in that folder.

Decided in the plan rather than by the spike: hook transport (a shared command hook writing an events file). Resolved by the spike: whether `codex://threads/<id>` opens a CLI-created thread (it does).

### Deferred

- Mascot design, planet names, and sound.
- Whether Linux and Windows stay supported. Default is macOS-first, with inherited code paths kept but untested.
- Cadence for reviewing upstream changes.
- License for Moon Base's own additions. Default is to continue under MIT.
- Terminal launchers other than cmux (Terminal.app, iTerm2, Ghostty, tmux), and Windows shells. The launcher table in `server/lib/terminal.mjs` is where they would go.
- The rest of the v2 ideas, none specified yet: a cross-repo "needs you" view, insight on the card (what the agent last said or asked, a "today" timeline, a PR link for CLI sessions read from Claude transcripts), a fuller doctor command, and sound, mascot and planet polish. They are in [the v2 brainstorm](../../brainstorms/2026-09-26-001-v2-roadmap-idea.md), together with the parked village or farm theme.

## Decision Links

- [Fork Bot Crossing and trim it to Claude Code and Codex](../../decisions/2026-09-26-fork-bot-crossing-and-trim-to-two-tools.md)
- [The opt-in hook installer is the only thing that writes a tool's config](../../decisions/2026-09-26-opt-in-hook-installer-is-the-only-config-writer.md)
- [Sessions open through URL schemes only, and the server starts no other process](../../decisions/2026-09-26-open-sessions-through-url-schemes-only.md) (superseded by the terminal hand-off decision below)
- [Terminal hand-off: a copied command, and an opt-in cmux launcher](../../decisions/2026-09-26-terminal-handoff-copy-command-and-opt-in-launcher.md)
- [Live status comes from one shared hook that appends to a private events file](../../decisions/2026-09-26-live-status-through-a-shared-hook-and-events-file.md)
- [Live status also comes from cmux's own event stream, read automatically and metadata only](../../decisions/2026-09-26-live-status-from-cmux-event-stream-metadata-only.md)
- [moonbase1 is one command that starts the server in-process and finds a running copy by asking it](../../decisions/2026-09-26-moonbase1-starts-in-process-and-finds-copies-by-asking.md)
- [The Open sessions with setting defaults to Automatic](../../decisions/2026-09-26-open-sessions-with-defaults-to-automatic.md)
- [The bot is an original design on CC0 art, and the shipped look is Rover](../../decisions/2026-09-26-original-bot-from-cc0-art-rover.md)
