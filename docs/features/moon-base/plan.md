---
status: active
created: 2026-09-25
origin: docs/features/moon-base/spec.md
depth: deep
---

# Moon Base Implementation Plan

## Problem and Scope

Deliver the Moon Base living spec ([spec](spec.md)): a local colony view of Claude Code and Codex sessions, forked from Bot Crossing (MIT, upstream commit `d05ac2ffad9fce3d68e29ab446fce99b7123847b`, 2026-09-18), with its own theme and original bot, opt-in live status hooks, and URL-scheme controls by default, with an opt-in terminal hand-off (Unit 10).

In scope: everything in the spec's Acceptance Criteria AC1 to AC15. AC14 (live status without hooks) and AC15 (easy start, the `moonbase1` command) are the v2 slice added on 2026-09-26 from `docs/brainstorms/2026-09-26-001-v2-roadmap-idea.md`; Units 11 to 15 build them. The rest of v2 (needs-you view, insight, polish) is not planned here.
Out of scope: the spec's Boundaries and Non-Goals, plus the Deferred Work below.

Assumptions:
- macOS is the only platform we test and claim. Inherited Windows and Linux helper code stays but is unclaimed.
- Node 22.13 or newer. Local is v22.22.0.
- Upstream's session-store layouts and URL paths were observed to work on this machine (see the spec's spike findings). The items still unverified are listed in the spec's Still open section.
- No git repo or remote exists yet, so PR and CI steps in the workflow cannot run until one is created.

Dependencies: Claude.app (`claude://`), ChatGPT.app (`codex://`), Claude Code 2.1.x, Codex CLI 0.157.x, three CC0 asset sources (fetched at execution), and upstream's MIT code. For AC14 and AC15: cmux's event stream (`~/.cmuxterm/workstream.jsonl`, an undocumented format), Claude Code's own live-session marker (`~/.claude/sessions/<pid>.json`), and Vite for the production build.

## Requirements Traceability

| Spec item | Units | Verified by |
|---|---|---|
| AC1 both tools discovered, unique prefixed IDs | 3 | `test/scan-harnesses.test.mjs`, `test/support/fixtures.mjs` |
| AC2 status precedence | 3, 5 | `test/status-precedence.test.mjs` |
| AC3 read-only toward session data | 3, 4, 5 | `test/readonly-guard.test.mjs` |
| AC4 local-only | 3, 4 | `test/open-security.test.mjs`, manual check M4 |
| AC5 hooks opt-in and reversible | 6 | `test/hooks-install.test.mjs` |
| AC6 live status per tool | 1, 5, 11 | `test/hook-script.test.mjs`, `test/hook-events.test.mjs`, `test/live-api.test.mjs`, `test/live-layers.test.mjs`, manual check M2 |
| AC7 graceful fallback | 5, 11 | `test/hook-events.test.mjs`, `test/live-api.test.mjs`, `test/live-layers.test.mjs` |
| AC8 URL schemes by default | 1, 4, 10 | `test/open.test.mjs`, `test/open-security.test.mjs`, manual check M3 |
| AC9 own identity | 2, 7 | `test/identity.test.mjs`, manual check M5 |
| AC10 art licensing | 7 | `test/identity.test.mjs` |
| AC11 attribution and license | 2 | `test/identity.test.mjs` |
| AC12 only two adapters | 2, 3 | `test/identity.test.mjs` |
| AC13 terminal hand-off, opt-in | 10, 16, 17 | `test/terminal-handoff.test.mjs`, `test/terminal-lib.test.mjs`, `test/open-mode.test.mjs`, `test/open-security.test.mjs`, `test/harness.test.mjs`, manual checks M6, M10 and M11 |
| AC14 live status without hooks | 11, 12, 15 | `test/cmux-stream.test.mjs`, `test/live-layers.test.mjs`, `test/live-api.test.mjs`, `test/harness.test.mjs`, `test/live-chip.test.mjs`, manual check M7 |
| AC15 easy start | 12, 13, 14, 15 | `test/cli-dispatch.test.mjs`, `test/cli-start.test.mjs`, `test/cli-doctor.test.mjs`, `test/serve.test.mjs`, `test/identity-route.test.mjs`, `test/open-mode.test.mjs`, manual checks M8 and M9 |

Test policy is `acceptance-first` (`docs/workflow/config.yml`): in every unit, write the acceptance tests from the table above first, watch them fail, then implement.

## Relevant Existing Patterns

No local code yet, and `docs/standards/index.yml`, `docs/decisions/index.yml` and `docs/learnings/index.yml` are empty, so no standards apply. Patterns to keep from upstream, which are what the fork brings in:

- Adapters in `server/harnesses/` are read-only, cache against file mtimes, read file heads through `server/lib/fsutil.mjs`, skip malformed records, and expose `diagnostic()`.
- `server/scan.mjs` merges adapter output into one thread list. `server/api.mjs` serves it with loopback binding and Host/Origin checks.
- Tests use `node --test` with `test/support/with-server.mjs` and `test/support/env.mjs` for a fake HOME.
- Thread IDs are prefixed `claude-code:<uuid>` and `codex:<uuid>`.
- For AC14: `server/hooks/events.mjs` (`EventTail`, `parseEvent`) and `server/hooks/live.mjs` (`LiveStatus`, `stateFor`, TTLs) already implement "a tailed file becomes per-session state laid over the scan, never creating a bot". A second source should reuse them, not copy them. `test/hook-events.test.mjs` and `test/live-api.test.mjs` show how to test it (a temp events dir, an injected clock, `withServer`).
- Test seams: `setOpener`, `setTerminalRunner`, `setSessionProbe` and `setForegrounder` in `server/api.mjs`, wired to recorders in `test/support/with-server.mjs`, so no test starts a real process. New process-touching code in `cli/` follows the same pattern with injected dependencies.
- `hooks/` and `bin/` are kept out of reach of `server/` (D5), with a source scan in `test/hooks-install.test.mjs`. The new `cli/` directory follows the same rule.
- `docs/learnings/2026-09-26-mutation-check-regression-tests.md`: a test guards a rule only once it fails with the rule removed. Each unit below lists the mutations to run.

## Decisions

- **D1. Import by copying selected paths at the pinned SHA, not by git fork or subtree.** Rationale: we drop about half the tree, upstream history adds nothing we use, and the spec says upstream changes come by manual cherry-pick. `UPSTREAM.md` records the SHA and what was dropped.
- **D2. One hook script for both tools, silent, always exit 0. Synchronous for `Stop`, `StopFailure` and `SessionEnd`, asynchronous for everything else.** Rationale: Codex has no HTTP hook type, and hook stdout is parsed by both tools, so a status hook must never print. An asynchronous terminal-event hook was lost once in the spike when the process exited right after it, and a synchronous one costs about 10 ms. Both tools support `async: true` for the chatty events.
- **D3. Events go to an append-only file under `~/.moon-base/events/` (override `MOON_BASE_HOME`), directory mode 0700, file mode 0600.** Rationale: hooks keep working while the app is closed, and only your user can write events. The hook script and the server both refuse an events directory or file that another user could write to. Other processes running as you can forge events. That is the same trust boundary as your session files, and the spec limits the damage to display state.
- **D4. The server applies an event only to a session ID it already knows.** An event for an unknown ID is held for a minute in case the scan is a step behind, then dropped. Rationale: a forged event can never create a bot or reach an action.
- **D5. The installer is CLI-only. No HTTP route can read or write tool configs.** Rationale: a web page, even one that passed Origin checks, must never be able to edit `~/.claude` or `~/.codex`.
- **D6. Codex hooks go in a `~/.codex/hooks.json` that Moon Base owns, not by editing `config.toml`.** Rationale: rewriting TOML without disturbing comments and your existing `notify` is fragile. The spike confirmed that a user-level `hooks.json` next to a `[hooks.state]` table produces no warning, and that Codex itself rewrites `config.toml` while other things run, which is the concurrent-write risk this avoids.
- **D7. The hook is a small `sh` wrapper copied to `~/.moon-base/bin/` at install, referenced by a constant command string.** The wrapper finds Node itself and exits 0 silently if it cannot. Rationale: Codex trusts each hook by `<hooks.json path>:<event>:<group index>:<handler index>` plus a hash of its definition, so the command string and the hook's position must not change. The spike showed that changing only the script's contents does not require re-trust, so the script can be updated freely. The wrapper uses shell built-ins only and discards shell-level errors, because with a bare PATH even `dirname` can be missing and the shell would print into the session. It also removes the dependence on `node` being on the hook's PATH, which held in every environment tried but depends on the user's Node install. The installer appends to the event lists and never reorders existing entries, so other hooks' positions and trust are unaffected.
- **D8. The set of registered hook events is minimal:** `UserPromptSubmit`, `PermissionRequest`, `PostToolUse`, `Stop` and `SessionEnd` for both tools, plus `Notification` and `StopFailure` for Claude Code. `PostToolUse` flips `awaiting` back to `running` after you approve. `PreToolUse` and `SessionStart` are not registered. Rationale: Codex prints two visible lines per hook per event (14 lines for a two-tool turn in the spike), so every extra event is user-visible noise. Whether the permission events actually fire is still open in the spec and is a checkpoint in Unit 5.
- **D9. Rebuild art from original CC0 sources.** Do not copy upstream's built `public/assets/`, its `design/` drafts, its `tools/build-crew.mjs` character pipeline, or its `TRADEMARKS.md`. Rationale: spec AC9 and AC10, and upstream reserves its character designs.
- **D10. Delete terminal launching.** Remove `server/lib/terminal.mjs`, `server/lib/win-terminal.mjs` and the CLI fallback command from adapters. Also remove `server/lib/windows.mjs`, the PowerShell window-focus helper, because it is a second kind of subprocess and AC8 allows only the OS opener. Rationale: non-goal in the spec, and it removes every place the server builds a command line. **Superseded in part by D11 (2026-09-26):** upstream's launcher stays deleted, and Unit 10 adds a new, much smaller one.
- **D11. Terminal hand-off is data from the adapters, validated and run in one file.** Adapters gain `terminalOpen(ref)` and `terminalNew(dir)`, returning `{ ok, argv, cwd }` and never running anything. `server/lib/terminal.mjs` alone checks every argv token against `[A-Za-z0-9._-]`, quotes the folder for the pasted line, and (only with `MOON_BASE_TERMINAL=cmux` in the server's environment) runs `cmux new-workspace --cwd <folder> --command <line> --focus true` with `execFile` and no shell. Two fixed routes, `POST /api/terminal-command` and `POST /api/terminal-launch`, plus `GET /api/terminal-launcher` for the page to learn whether the launcher is on. The page's `Open sessions with` setting picks app, copy or terminal, and a stored `terminal` choice falls back to copy when the launcher is off. Rationale and alternatives: `docs/decisions/2026-09-26-terminal-handoff-copy-command-and-opt-in-launcher.md`.
- **D12 (added 2026-09-26, from M6).** Before the cmux launcher opens a thread, it asks cmux's own `sessions --agent <agent> --session <id> --json` (no socket needed) whether that session is already open, and skips the launch if so. Adapters now name the exact id being resumed (`resumeId`, alongside `argv`/`cwd`) so the server can ask without parsing a command line apart. Rationale: found live during M6 — clicking Resume on an already-open thread started a second `claude --resume` on the same session, racing the one transcript file both processes write. The probe never blocks an ordinary launch on its own failure (any error, missing `cmux`, or a shape it does not recognise reads as "not open"), and it never runs for a new session (which has no id to ask about) or for copy mode (which starts nothing to duplicate).
- **D13 (added 2026-09-26, from the same M6 report).** After a cmux launch succeeds, or is skipped as already open, the server also runs `open -a cmux` (macOS only), best-effort, result never read. Rationale: also found live during M6 — cmux never came to the foreground on either a fresh launch or a skip, because `new-workspace --focus true` only selects the workspace *inside* cmux's own window and nothing in cmux's CLI raises the *application* itself. `open -a cmux` is the same OS primitive the existing desktop-app opener already uses for `claude://`/`codex://` links, applied to a fixed, hardcoded app name that a request can never change — `test/open-security.test.mjs` asserts `open` is named exactly once in `terminal.mjs`, and only as `['open', '-a', 'cmux']`.
- **D14. cmux rows reuse the hook pipeline (AC14; resolves Q1).** `EventTail` gets optional `parse`, `maxLine`, `seedBytes` and `seedMs` (defaults unchanged, so hooks behave exactly as now). A new `server/hooks/cmux.mjs` turns one `workstream.jsonl` row into the same normalised event and maps kinds onto the hook vocabulary, so `stateFor` is untouched: `userPrompt` to `UserPromptSubmit`; `toolUse` and `toolResult` to `PostToolUse`; `permissionRequest` and `question` to `PermissionRequest`; `stop` to `Stop`; `sessionEnd` to `SessionEnd`; `sessionStart` ignored. The session id comes from `workstreamId` (`cmux-feed-v1:<base64 source>:<base64 id>`) and is accepted only when there are exactly three parts, the first is `cmux-feed-v1`, the decoded source equals the row's `source` (`claude` or `codex`), and the id passes the existing id pattern. Only `kind`, `source`, `cwd`, `createdAt` and that id are read from a row, and the parsed object is dropped as soon as they are picked: `payload`, `title` and `context` are never retained. Rationale: one state machine and one TTL table for every source (AC6, AC7), and the privacy rule lives in one function that a sentinel test can pin. Q1 is settled by the data: a `question` row's payload is a pending request like `permissionRequest` (`requestId` plus the questions), and cmux marks exactly those three observed rows `status: pending`, so both mean awaiting input. Codex rows beyond `sessionStart` were not observed, so Codex works through the same mapping by kind and anything unknown is ignored.
- **D15. Newest wins across sources.** `LiveStatus` replaces a session's entry only with one at least as new. Rationale: two tails now feed one map, and an older cmux row read after a newer hook event would otherwise put a bot back in a state it had left. It applies to hooks alone too. A session's end counts as an event with a time: it is remembered (as long as the longest state limit, six hours, after which anything older has expired anyway), so an older event read afterwards cannot bring the session back. Added after PR review.
- **D16. Claude's marker is read in the adapter.** `livePending` in `server/harnesses/claude-code.mjs` already reads `~/.claude/sessions/*.json` to know which processes are alive. It also keeps `status` and `statusUpdatedAt` for those, and the thread gets `markerStatus` and `markerAt`. The overlay treats `busy` as a running candidate dated `markerAt`, competing under D15, and `idle` as nothing (AC14). `liveSource` is `claude` when it wins. If two live processes share a session id (the duplicate resume the launcher guard exists to prevent), the newer marker speaks for it and busy wins a tie, so the answer never depends on the order of the files (added after review). No off switch: it is Claude's own file and is already read.
- **D17. Sources reach the page as a list.** `summary()` gains `sources: [{ id, present, lastAt }]` for `hooks` and `cmux`, and `active` counts cmux. The chip names cmux only while its stream exists and the switch is not off (`Live · Claude Code ● Codex ○ · cmux ●`). The Claude marker is not a chip source: it is a snapshot, not something that reports.
- **D18. Off switch and location (resolves Q3).** `MOON_BASE_CMUX_STATUS=off` (also `0`, `false`, `no`, any case) switches the cmux source off, and then its files are never opened. Any other value, or none, leaves it on. `MOON_BASE_CMUX_DIR` overrides `~/.cmuxterm`, for tests and unusual installs, like `CODEX_HOME`. Rejected: a general `MOON_BASE_LIVE_SOURCES` list, since one source is switchable today.
- **D19. What the cmux tail reads (resolves Q2 as far as it can be settled here).** On start it replays the last 6 hours or 1 MiB, whichever is smaller. The longest state lifetime is 6 hours (a permission prompt left waiting), and the hook defaults of 10 minutes and 256 KiB would forget it. It accepts lines up to 512 KiB, because rows carry tool inputs (hook lines are capped at 4 KiB), and a longer line is skipped without stalling the tail. It inherits the tail's handling of truncation, replacement and a half-written last line. `cmux feed clear` shows the history is user-clearable, so a shrinking file is normal. cmux's own rotation policy could not be determined here and is observed at work (M7).
- **D20. `moonbase1` is one entry with subcommands, outside `server/` (AC15).** A new `cli/` directory holds start, doctor, the build check, the port probe, cmux detection and the page opener. `bin/moon-base.mjs` dispatches: no arguments or `start` starts Moon Base, `doctor` runs the doctor, and `install-hooks`, `uninstall-hooks` and `hooks-status` go to `hooks/cli.mjs` as now. `package.json` gains `bin: { moonbase1: bin/moon-base.mjs }`, and `npm run moon-base -- <command>` keeps working. Nothing under `server/` imports `cli/`, and a test scans for it. cmux is recognised when `CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID` are both set (both observed in a process cmux started).
- **D21. Start runs the production build in-process.** It sets `PORT` and, when inside cmux and `MOON_BASE_TERMINAL` is unset, `MOON_BASE_TERMINAL=cmux`, then starts the server. An explicit value always wins, including one that disables the launcher. `server/serve.mjs` is refactored to export `serve({ port, host, dist })` and still starts itself when run directly, so an in-use port becomes a message rather than a crash. In-process keeps the server a descendant of the cmux terminal, which is what cmux's socket rule needs, and keeps Ctrl-C simple. The build runs `tools/build-assets.mjs` and then Vite's build with `process.execPath`, so it depends on neither `npm` nor the PATH. A build is stale when the newest modification time under `src/`, `public/`, `index.html`, `vite.config.js`, `package.json`, `package-lock.json` or `tools/` is newer than `dist/index.html`, or there is no `dist`. (The lockfile and `tools/` were added after PR review: a lockfile-only update changes the bundle, and `tools/` holds the scripts that make the assets. `assets-src/` is deliberately not watched: it is large and only the asset step reads it, so whoever re-downloads a pack runs `npm run build`. The moonbase1 decision record lists the original five; this is the current list.) A failed build stops with the build's own output rather than serving something stale. This settles the stale-build part of Q4.
- **D22. Already-running is found by asking, not by a lock file (settles the rest of Q4 apart from PATH).** A new read-only `GET /api/identity` answers `{ app: 'moon-base', version, pid, launcher }`, behind the existing Host and Origin checks. Start probes the default port and the next 20 (from `PORT` when set). A Moon Base answer means reuse: say so, note it if that copy has the launcher off while this terminal is inside cmux, and open the page. Anything else, or a refusal, means try the next port, and the first free one is used. Rationale: it also finds copies started with `npm run dev`, and leaves no file to go stale.
- **D23. `openWith` defaults to `auto`.** `resolveOpenMode('auto', launcher)` is Terminal when the server has a launcher on and Desktop app otherwise, and the select gains an Automatic entry. Browser storage is per origin (the port is part of it) and every settings write persists the whole object, so "not yet chosen" cannot be read back from storage, but a value that means it can. Installs that already stored `app` or `terminal` keep it.
- **D24. Doctor is read-only and content-free.** `moonbase1 doctor` reports the environment (inside cmux or not, whether the launcher would be on), running copies, whether the build is fresh, and for each source (hooks events file, cmux stream, Claude markers) whether it is present, reporting, and the age of the last event, with a reason when it is not: missing, unreadable, refused because of its permissions, switched off, or no events in the last 10 minutes. It prints kinds, counts and ages and never a row's content, and it exits 0. `EventTail` records why it returned nothing so the doctor and the tests can say so.
- **D25. Resume's already-open check has a second, hook-free source: Claude's own marker (AC13; added 2026-09-26, after M7 was tried at work).** `cmux sessions` reads only `~/.cmuxterm/claude-hook-sessions.json`, which cmux's Claude hooks write, and they are injected only while cmux's Claude Code integration is on. At work it is off, so the record was empty and every Resume started a second `claude --resume` on a live session. The launch route now asks cmux and the adapter together, and either answering open holds the launch back. An adapter gets an optional `sessionRunning(id)` beside `terminalOpen`, wrapped in `server/scan.mjs` the way the terminal methods are, so the route never reads Claude's files itself. Only Claude Code has one; Codex keeps depending on cmux. The response stays `{ ok: true, already: true }` for cmux and gains `via: 'claude'` only when the marker answered, so the existing answer is unchanged. The page says "Already running" for that case, because the marker cannot say which terminal holds the session. Errors on either side read as not open, so this can never be the reason an ordinary resume fails. The probe is a seam (`setRunningProbe`) with an always-no default in the test server, so no test reads the real `~/.claude/sessions`.
- **D26. Which markers count.** A marker counts when its pid is alive (the same `process.kill(pid, 0)` test the colony already uses), its `sessionId` is the one being resumed, and its `entrypoint` is not `claude-desktop`. Rationale: the desktop app pre-warms idle processes (measured 16 hours to 3 days idle), so counting them would silently stop terminal Resume for every thread the desktop app has warmed, a regression on a machine that runs both; on the personal machine a terminal-started session's marker reads `entrypoint: cli` and every desktop one reads `claude-desktop`. It is a denylist so any other terminal-like host still counts. Known limit: a stale marker whose pid was reused by an unrelated process would hold Resume back. Checking process start time would close that, but it needs a new process-spawning site (`test/open-security.test.mjs` allows exactly three files) and the marker's `procStart` is in UTC while `ps` prints local time, so it is left out; Copy mode always works as the way round.
- **D27. The doctor says why a Resume duplicates, counts only.** A new `cmuxSessionsSummary` in `server/lib/terminal.mjs` (the one file that already runs cmux) runs the fixed `cmux sessions --agent claude --json` and returns only `{ answered, count }`; the doctor turns that and Claude's marker counts into a "Resume check" row. The missing-stream line no longer asks whether cmux is installed: it says cmux writes the stream only while its Claude Code integration is on.
- **D28. A fifth way to open, `foreground`, that only brings cmux to the front (AC13; added 2026-09-26, at the person's request).** Where sessions already run in cmux and hooks are unavailable (the work machine), the person wants Open to get them to cmux and nothing else. `OPEN_MODES` gains `foreground`; `resolveOpenMode` gives it only with a launcher, otherwise `copy`, like `terminal`. The server gets a fourth fixed route, `POST /api/terminal-foreground`: it needs the launcher, reads and ignores the body, runs `foregroundArgv` (the one argument list, `open -a cmux`) once, and answers `{ ok: true }` or, in one fixed sentence, that cmux could not be brought forward. `runForeground` now resolves `{ ok }` instead of nothing: the calls after a launch still ignore it, but this route's whole purpose is the result, so a failure must not read as success. No new process-spawning site: the same function and the same single `open` spelling that `test/open-security.test.mjs` already pins. The Open button reads "Show" and a new-thread button says the thread is still the person's to start; a subagent's Open stays disabled, as in every mode. Not chosen: selecting the workspace that holds a session, which cmux's CLI cannot do (see the spec's Still open).

Alternatives considered:
- A clean-room rebuild was rejected by you earlier.
- An HTTP hook for Claude Code was rejected because it would give Codex and Claude different paths and fail noisily when the app is closed.
- Editing settings from a UI button was rejected under D5.

## Implementation Units

### Unit 1. Live verification spike (needs your explicit go-ahead first)

Goal: replace the spec's on-paper findings with observed behavior before any design depends on them. This unit opens URLs, launches your apps and runs hooks, so nothing starts until you say yes.

Method: use a scratch project outside this repo. Install probe hooks at project scope in that scratch project (`.claude/settings.local.json`, `.codex/hooks.json`), not in `~/.claude` or `~/.codex`. Codex will ask you to trust the project layer and its hooks.

Checks, each with a recorded pass or fail:
1. Claude Code hook events fire for: prompt submit, tool use, permission prompt, stop, and a forced API failure. Record payload fields and confirm `session_id` equals the CLI transcript UUID.
2. Codex hook events fire for: prompt submit, tool use, permission request, stop, interrupt. Record payload fields and confirm the ID matches the rollout UUID and `state_5.sqlite` thread ID.
3. The hook process environment: is `node` on PATH, what does the working directory look like, and how long does a spawn take (cost per event).
4. Codex: a user-level `hooks.json` alongside your existing `[hooks.state]` produces no merge warning (decides D6).
5. Codex: changing only the script content, not the command string, does not invalidate hook trust (decides D7).
6. The five URL paths against the throwaway session, on Claude.app and ChatGPT.app: open existing, resume CLI-only (note the import side effect), new session in folder, `codex://threads/<id>` for desktop and CLI-only sessions, `codex://threads/new?path=`.
7. `node:sqlite` opens `~/.codex/state_5.sqlite` read-only on Node 22.22 without a flag.

Outputs: update the spec's Spike findings and Open Questions with observed results; capture learnings with `aw-capture`. Decision rule: any failed check changes the spec first (for example marks a class of bots not openable, or adds a per-tool carve-out) before later units proceed.

Files touched: `docs/features/moon-base/spec.md` only. The scratch project lives in the session scratchpad.

### Unit 2. Repo bootstrap and upstream import

Goal: a clean repo with upstream's retained code, correct license and attribution, and no branding or assets we must not carry.

- Run `git init` and create a feature branch. Do not commit unless you ask.
- Get explicit permission for the download, stating the repo (`github.com/Station-Sciences/bot-crossing`), the pinned SHA and the size at that time. Clone shallow into the scratchpad and copy selected paths into the repo.
- Keep: `server/` (minus D10 files and the five adapters other than `claude-code.mjs` and `codex.mjs`), `src/`, `test/` (pruned in Unit 3), `tools/` (minus `build-crew.mjs`, `bot-showcase.*` and `face-sheet.*` pending Unit 7), `vite.config.js`, `index.html`, `package.json`, `package-lock.json`, `LICENSE`.
- Drop: `TRADEMARKS.md`, `DECISIONS.md`, `CONTRIBUTING.md`, `design/`, built `public/assets/`, `.claude/skills/agent-session-world/` (kept only as a reference in the scratchpad while porting).
- Add: `UPSTREAM.md` (source URL, SHA, date, what was dropped and why), a README stating the project is based on Bot Crossing and is not endorsed or maintained by it, `.gitignore` entries (`node_modules/`, `dist/`, `data/colony.json`), and the Moon Base copyright line added to `LICENSE` without removing upstream's.
- Do not touch the existing `.claude/settings.json`, `.claude/hooks/log-session.sh`, `AGENTS.md`, or `docs/`.

Tests: `test/identity.test.mjs` first, covering AC11 (LICENSE contains upstream's MIT notice, `UPSTREAM.md` has a 40-hex SHA, README states the based-on and not-endorsed lines), AC12 (harness registry lists exactly `claude-code` and `codex`), and the AC9 name checks (`package.json` name and `index.html` title are not "bot-crossing" or "Bot Crossing").
Edge cases: the copy must not bring upstream `.git`, `node_modules`, or `data/colony.json`. `npm install` must run no lifecycle scripts that touch tool configs (D5, AC5).
Verification: `npm install` and `node --test test/identity.test.mjs` pass.

### Unit 3. Trim to two adapters and get a green baseline

Goal: AC1, AC2, AC3, AC12 on the retained code.

- Files: `server/harnesses/index.mjs`, `server/harnesses/README.md`, `server/api.mjs`, `test/harness.test.mjs`, `test/state.test.mjs`, `test/open.test.mjs`; delete `test/terminal.test.mjs` with D10. `src/game/status.js` holds the status logic, split out of `src/game/colony.js` so it can be tested without the scene code.
- Share fixtures through `test/support/fixtures.mjs`, which fakes both installs on disk (Claude Code CLI transcripts and desktop records, Codex rollout files), plus a minimal `state_5.sqlite` builder inside `test/harness.test.mjs`, so tests never read real home data.
- Tests to add: `test/status-precedence.test.mjs` (every ordered pair: errored over running over PR merged over awaiting over dormant over idle; the badge rule is checked manually in M1), `test/readonly-guard.test.mjs` (both installs unchanged after a full scan and every read and write route; only the colony state file may be written), and `test/scan-harnesses.test.mjs` (both tools found, unique prefixed ids even for one raw id in both tools, malformed files skipped).
- Edge cases: a desktop record and a CLI transcript for one conversation merge into one bot. Stale `task_started` older than 30 minutes is not "running". A Codex thread that the database marks as spawned by a task stays off the map even though its rollout file exists.

### Unit 4. URL-scheme controls, hardened

Goal: AC8, and AC4 for the routes involved.

- Files: `server/api.mjs`, `server/harnesses/claude-code.mjs`, `server/harnesses/codex.mjs`, `src/game/api.js`, `src/ui/hud.js`, `src/agents/picking.js`, `test/open.test.mjs`.
- Behavior: exactly two actions, open-thread and new-session. The thread ID must exist in the latest scan. The folder for a new session must be a known repo path. The URL is built by the adapter from encoded parts and checked against a `claude://` and `codex://` allowlist. The only subprocess is the OS opener with a fixed argument array and no shell. Adapters return `{ ok, url, reason?, opensAsNewSession? }` with no `command` field.
- UI: bots that cannot be opened show why. A CLI-only Claude session shows the import warning before it is opened. Each zone has a start-session control with a tool choice.
- Tests first: `test/open-security.test.mjs` (unknown ID refused, path outside known repos refused, other schemes refused, ID and folder injection strings encoded or refused, no route accepts a command or URL from the request) plus the adapted `test/open.test.mjs`.
- Checkpoint: URL builders follow whatever Unit 1 observed, not upstream's strings.

### Unit 5. Live status pipeline

Goal: AC6 and AC7, using D2, D3, D4 and D8.

- New files: `hooks/moon-base-hook.mjs` (the script), `server/hooks/events.mjs` (tail, validate, normalize), `server/hooks/state.mjs` (per-tool mapping tables and the status overlay). Edit `server/scan.mjs` to apply the overlay and `src/ui/hud.js` for a small "live or inferred" indicator.
- Hook script: reads stdin JSON, appends one bounded line to the events file, prints nothing, and exits 0 on any failure (garbage input, oversized input, unwritable directory). It keeps its own work minimal because it runs on every event.
- Server: watch the file with an offset, tolerate partial lines and truncation, rotate at a size cap. Validate against an allowlist of event names, an ID charset, and size limits. Unknown IDs follow D4.
- Overlay: hook-derived state expires. If a session is shown as running or awaiting and no event has arrived for a set period, the file-inferred state wins (AC7). Precedence stays as in AC2. Codex errored is always file-inferred. While hooks are reporting the page polls every 3 seconds instead of 15, so a status change shows within about one poll: that fixes the AC6 latency target at roughly 3 seconds.
- Tests first: `test/hook-script.test.mjs` (line written, modes 0700 and 0600, silent, exit 0 on garbage, oversize and unwritable target) and `test/hook-events.test.mjs` (per-tool mapping, spoofed unknown ID changes nothing, overlay expiry, awaiting returns to running after the post-tool event, partial line and truncation, rotation, and the latency target once Unit 1 fixes it).
- Failure modes: events file deleted while tailing (recreate and reset offset). Server started after events already exist (read only recent lines). Very high event rate (drop-safe, bounded memory).
- Checkpoint: before relying on `PermissionRequest` and `Notification`, verify that they fire in an interactive session of each tool and in a Claude Code desktop-app session (see the spec's Still open section). Where a tool does not signal them, "awaiting input" for that tool stays inferred from files.

### Unit 6. Hook installer and uninstaller

Goal: AC5 and the AC3 exception.

- New: `bin/moon-base.mjs` (run as `npm run moon-base -- <command>`), backed by `hooks/install.mjs`, `hooks/cli.mjs`, `hooks/diff.mjs` and the `hooks/moon-base-hook` wrapper, with `install-hooks`, `uninstall-hooks`, `hooks-status`, plus `--tool` and `--dry-run`. No `--yes` flag: confirmation is the point.
- Behavior: read the target config, build the change, print the exact diff, require confirmation, then write atomically (temp file and rename) and refuse if the file changed since it was read, because Claude Code also writes `settings.json`. Copy the hook script to `~/.moon-base/bin/` (D7). Mark every entry so uninstall can find exactly ours. Claude: entries under `hooks` in `~/.claude/settings.json`. Codex: `~/.codex/hooks.json` (D6). After a Codex install, print the `/hooks` trust instruction. `hooks-status` reports installed state and time of the last event received. For Codex, if the hooks are installed but no event has ever arrived, it says so and points to the `/hooks` review, because untrusted hooks are skipped with no message.
- Never: touch `notify`, edit any other key, pass `--dangerously-bypass-hook-trust`, or run during `npm install`, app start or first run.
- Tests first, all against a temp HOME in `test/hooks-install.test.mjs`: only marked entries added, existing hooks and unrelated keys deep-equal afterwards, decline leaves files byte-identical, re-install is idempotent, uninstall removes only ours and deletes `hooks.json` only if we created it and it is now empty, a read-only target fails cleanly with the original intact, a mid-run modification aborts, the server starting against a temp HOME touches no config, and no source file contains the trust-bypass flag. The no-route-writes-configs rule (D5) is checked two ways in the same file: a source scan (server and page code may not mention where a tool keeps its config) and a run of every route against a temp HOME.

### Unit 7. Theme and original bot

Goal: AC9 and AC10.

- Checkpoint before building: propose two or three original bot concepts with quick previews using the retained showcase tooling, and get your pick. This is a taste decision. It cannot be inferred.
- Art: fetch the CC0 packs from their original sources with explicit permission for each download (name, source, size), verify CC0 on the source page, and record source URL, license and retrieval date in `public/assets/CREDITS.md`. Rebuild with `tools/build-assets.mjs` (adapted). Build the bot from a CC0 base rig with our own head, colors and accessories, in a new `tools/build-bot.mjs`, and keep procedural faces and animation code. Do not reuse upstream's `crew` character output.
- Theme: lunar palette, sky and grading in `src/core/` and `src/world/sky.js`, HUD text and styles in `src/ui/`, rename `src/agents/astronauts.js` and `src/agents/crew.js` to reflect the new bot, default world set to the lunar one.
- Tests first: extend `test/identity.test.mjs` (AC9: no user-visible "Bot Crossing" except in the attribution text; AC10: every file in `public/assets/` appears in `CREDITS.md` with a CC0 license and a source URL) and keep the upstream rendering and picking tests green (`test/rendering.test.mjs`, `test/picking.test.mjs`, `test/agent-model.test.mjs`).
- Verification: run the visual check tools and capture screenshots for manual check M5.

### Unit 8. End-to-end acceptance run (needs your go-ahead)

Manual checks on this machine, each with recorded evidence:
- **M1.** Start the app with `npm run dev`. Your real Claude Code and Codex sessions appear, grouped by repo, with the right states. (AC1, AC2)
- **M2.** Install hooks with the CLI in a scratch project scope first, then user scope. Run a throwaway session in each tool and watch running, awaiting-input, finished and (Claude) errored on the map within the target latency, then stop events and confirm fallback. Uninstall and confirm configs match a saved copy. (AC5, AC6, AC7)
- **M3.** Click an existing bot in each tool, a CLI-only Claude bot (see the import warning), and start a new session from a zone in each tool. (AC8)
- **M4.** Confirm the server listens only on loopback (`lsof`), a request with a foreign Host or Origin is refused, and no outbound connections occur during a run. (AC4)
- **M5.** Compare the bot and theme visually against upstream's screenshots and confirm no reused character or branding. (AC9)
- **M6.** From a cmux terminal, run `MOON_BASE_TERMINAL=cmux npm run dev`. In settings choose `Open sessions with: Terminal (cmux)`, then Open a Claude Code bot, Open a Codex bot, and start a new session from a zone. Each should make a cmux workspace in the right folder running the right command; resuming a thread already open in cmux should say "Already open" and start nothing new. Then run the server from a normal terminal and confirm the page shows the fixed "not started inside cmux" message. Also record the questions in the spec's Still open (focus, what happens when the tool exits). Done (2026-09-26), on the user's own machine: it worked end to end, and the run found and fixed a real bug (resuming an already-open session started a duplicate); the "started outside cmux" half and the duplicate-launch fix were checked against the real binary the same day. The same run also found cmux never came forward at all — `--focus true` only selects the workspace within cmux's window, not the application over the browser — fixed by D13's `open -a cmux`, mechanically confirmed to run without error but not yet confirmed by eye to raise the window every time. Still open: that visual confirmation, and what happens on exit.

### Unit 9. Docs and workflow close-out

- Files: `README.md` (macOS-only claim, setup, hooks install and uninstall, security notes including that any process running as you can forge status, attribution), `docs/features/moon-base/spec.md` (Current Behavior, updated), `docs/workflow/config.yml` (add `*.test.mjs` to `trace.test_paths` so acceptance-to-test tracing sees these tests).
- Capture the four spec decisions plus D2 to D8 as immutable decision records with `aw-capture`.
- Run `aw-review` and `aw-check-workflow-compliance`, and satisfy the configured gates (`review`, `capture`, `check_workflow_compliance`) before any commit or PR.

### Unit 10. Terminal hand-off (added 2026-09-26)

Goal: AC13, so Moon Base is usable where the desktop apps are not installed (cmux at work). High-Risk under `AGENTS.md`: it changes AC8, which was a security boundary, so the spec and a decision record were updated first (done), and review evidence is still owed before any PR.

- Files: `server/lib/terminal.mjs` (new), `server/harnesses/claude-code.mjs`, `server/harnesses/codex.mjs`, `server/harnesses/README.md`, `server/scan.mjs`, `server/api.mjs`, `src/game/api.js`, `src/game/open-mode.js` (new, pure so it can be tested), `src/core/settings.js`, `src/ui/hud.js`, `src/main.js`, `README.md`, and the tests below.
- Behavior: the routes in D11. Every route sits behind the existing Host and Origin checks. The thread or folder must come from the server's own scan, as in Unit 4. The cwd for a resume is the thread's own recorded folder and must still be a directory.
- Tests first (acceptance-first): `test/terminal-handoff.test.mjs` (both routes end to end with the launcher faked: exact command strings for both tools and for new sessions, a hostile folder name, refusal of unknown ids, folders, harnesses and control characters, ignored request fields, launcher off by default and for any unknown value, exact `cmux` argument list, launcher errors passed through as fixed messages, cross-origin refusal), `test/terminal-lib.test.mjs` (token allow-list, `shellQuote` round-trips through a real `sh`, error mapping with a fake `execFile`), `test/open-mode.test.mjs` (mode fallback), and an update to `test/open-security.test.mjs` (the list of files allowed to import `child_process`, and a scan that `terminal.mjs` never uses a shell).
- Mutation checks (see the learning on regression tests): remove the token allow-list, the env gate, the control-character refusal, the quoting, the already-open check (D12), its failure handling, and the `cmuxSessionOpen` parsing one at a time, and confirm the matching test fails each time. Done for all of these (2026-09-26); the last two needed dedicated unit tests for `cmuxSessionOpen` once mutated, because the handoff tests stub the probe and never exercise its own parsing. Also mutation-checked (2026-09-26, D13): the foreground call on each path, its platform guard, its hardcoded app name, and its own error being swallowed.
- Edge cases: a CLI-only Claude thread (no desktop record) resumes fine; a thread whose folder was deleted is refused with a message; a thread with no folder on record is refused; a Claude desktop record with no CLI id has nothing to resume.
- Not done here: running against a live cmux (manual check M6).

### Unit 11. cmux stream and Claude's marker as live sources (AC14, server; added 2026-09-26)

Goal: status is live at work with nothing installed. cmux's event stream and Claude's own busy/idle marker become live signals laid over the scan, metadata only, tolerant of any file trouble, and switchable. Decisions D14 to D19 and `docs/decisions/2026-09-26-live-status-from-cmux-event-stream-metadata-only.md`. High-Risk under `AGENTS.md`: it reads another app's private files that hold message content, so review evidence or explicit acceptance is needed before any PR.

- Files: `server/hooks/events.mjs` (`EventTail` options, and a recorded reason when it returns nothing), `server/hooks/cmux.mjs` (new), `server/hooks/live.mjs` (second tail, newest-wins, marker candidates, `summary().sources`), `server/harnesses/claude-code.mjs` (marker fields on threads), `test/support/fixtures.mjs` (`fakeCmux`, `fakeMarker`).
- Checkpoint before any code: build fixtures with the real row shape (keys `context`, `createdAt`, `cwd`, `id`, `kind`, `payload`, `ppid`, `source`, `status`, `title`, `updatedAt`, `workstreamId`) and invented content, with a sentinel string in every content-bearing field. Never copy a real row into the repo.
- Tests first (acceptance-first), each mapped to an AC14 example:
  - `test/cmux-stream.test.mjs`:
    - the mapping table for every kind and both tools, and `sessionStart` ignored;
    - `workstreamId` decoding: valid; wrong prefix; two or four parts; bad base64; decoded source not equal to `source`; id failing the pattern;
    - unknown kind ignored; missing or invalid `createdAt` becomes arrival time; a future one is clamped;
    - a line over 512 KiB is skipped without stalling the tail;
    - truncation, replacement, a half-written last line, and no trailing newline;
    - the cold-start window: an awaiting row 5 hours old still counts, one 7 hours old does not;
    - the permission rule: a group- or world-writable file is refused, mode 0644 is accepted;
    - the sentinel test: no event field contains the sentinel, and an event has only the allowed keys;
    - `cmuxStatusEnabled` for `MOON_BASE_CMUX_STATUS` values, and `cmuxFile` honouring `MOON_BASE_CMUX_DIR`.
  - `test/live-layers.test.mjs`:
    - hooks and cmux both feeding one map, with newest winning in both arrival orders;
    - `question` gives awaiting, then `toolResult` gives running, `stop` gives finished, `sessionEnd` forgets;
    - an end stays ended against an older event read afterwards, from either source, and a newer event brings the session back;
    - every state expires back to the files;
    - an event for an unscanned session is held for a minute, then dropped, and creates no bot;
    - marker `busy` is a running candidate, `idle` adds nothing, and the marker competes with events by time;
    - the off switch: the cmux file is never opened and the summary omits cmux;
    - `summary().sources` shapes, and `active` true when only cmux reports;
    - with cmux absent, behaviour is exactly what it was.
  - `test/live-api.test.mjs` (extend): through `withServer` with a `MOON_BASE_CMUX_DIR` fixture, a cmux row shows on the next `/api/threads` with `liveSource: 'cmux'`, `live.sources` names cmux, the off switch works, and the fixture's sentinel appears in no response body from `/api/threads`, `/api/harnesses`, `/api/state`, `/api/terminal-launcher`.
  - `test/harness.test.mjs` (extend): a Claude thread carries `markerStatus` and `markerAt` from a fake `sessions/<pid>.json` (busy, idle, no status field, dead pid, unparseable file).
- Edge cases: a session id valid but not scanned; duplicate rows; two scans at once (the tail already queues); `~/.cmuxterm` present but `workstream.jsonl` missing; a busy marker whose pid is gone or reused (the existing liveness check applies).
- Mutation checks (see the learning): keep `payload` on the event, drop the newest-wins guard, loosen the `workstreamId` checks (each one), remove the off switch, drop the permission rule, map `sessionStart` to running, skip the pid check on the marker, and shrink the cold-start window. Each must fail a named test.
- Verification: `npm test`. The existing hook tests must pass unchanged, which shows the hook path did not move.
- Ticket hint: "Live status from cmux's event stream and Claude's marker". Depends on nothing. Labels: server, privacy.

### Unit 12. The page: chip and Automatic open mode (AC14 chip, AC15 first-run default)

Goal: the Live chip names cmux while it reports and shows it as not reporting when it is present but quiet, and a fresh install inside cmux starts on Terminal. D17 and D23.

- Files: `src/game/live-chip.js` (new, pure, so it can be tested without the DOM), `src/ui/hud.js`, `src/game/open-mode.js`, `src/core/settings.js`.
- Tests first: `test/live-chip.test.mjs` (hooks only; cmux reporting; cmux present and quiet, including with nothing else reporting, when the chip still shows as `cmux ○`; cmux switched off or absent, which is never named; nothing reporting and no cmux, which hides the chip) and `test/open-mode.test.mjs` (`auto` gives terminal with a launcher and app without, unknown values still give app, `new Settings().get('openWith')` is `auto`, and a stored `app` or `terminal` survives a load through a stubbed `localStorage`).
- Edge cases: an install that already stored `app` keeps it; the select shows Automatic and its hint says what it resolves to; `_paintOpenHints` treats `auto` as the mode it resolves to.
- Depends on Unit 11's `summary()` shape. Manual check M9 for how the chip reads.
- Ticket hint: "Live chip names cmux; Automatic open mode". Labels: ui.

### Unit 13. `moonbase1` start (AC15)

Goal: one command starts Moon Base: fast, cmux-aware, on a free port or an existing copy, opening the page. D20 to D22.

- Files: `bin/moon-base.mjs`, `cli/dispatch.mjs`, `cli/start.mjs`, `cli/cmux-env.mjs`, `cli/port.mjs`, `cli/build.mjs`, `cli/open-page.mjs` (all new), `server/serve.mjs` (export `serve`), `server/api.mjs` (`GET /api/identity`), `package.json` (`bin`).
- Tests first:
  - `test/cli-dispatch.test.mjs`: no arguments and `start` start; `doctor` runs the doctor; the three hook commands reach `hooks/cli.mjs` unchanged; an unknown command prints usage and exits 2; `--help`.
  - `test/cli-start.test.mjs`, with every dependency injected (server start, port prober, build runner, page opener, env, file times):
    - inside cmux (both variables set, and each alone is not enough) sets `MOON_BASE_TERMINAL=cmux`; outside says the launcher is off;
    - an explicit `MOON_BASE_TERMINAL`, including one that disables it, is never overridden;
    - port choice: default free; taken by another program; taken by a Moon Base (reuse, with the launcher note); all 21 taken (a clear error);
    - the stale-build decision from temp trees (missing dist, newer source, equal, older), a failed build stopping with its own output, and a fresh build not being rebuilt;
    - `--no-open`; messages are plain lines and never print an env value.
  - `test/serve.test.mjs`: `serve` returns a handle and closes; an in-use port rejects with a code the start turns into a message; the static behaviour is unchanged, including `403` on path traversal and the SPA fallback.
  - `test/identity-route.test.mjs`: the shape, GET only, refused for a foreign Host, no paths or environment in the body.
  - Extend the source scan in `test/hooks-install.test.mjs`: nothing under `server/` or `src/` imports `cli/`.
- Edge cases: the port free at probe time but taken by listen time (the in-use rejection above); `MOON_BASE_HOST` set to a non-loopback address (print the README's warning); Ctrl-C shuts down cleanly; Windows is not a claimed platform (say so rather than fail oddly); a `dist` written by an older version.
- Mutation checks: drop the both-variables rule, let a request-shaped value set the launcher, override an explicit `MOON_BASE_TERMINAL`, treat a non-Moon-Base answer as "already running", skip the stale check, serve after a failed build, and let `server/` import `cli/`.
- Checkpoint M8, on the work machine: whether `npm link` is allowed there (Q4). The fallback is a shell alias, documented in Unit 14.
- Ticket hint: "moonbase1: one-command start". Depends on nothing in Units 11 and 12, so it can run in parallel with them. Labels: cli.

### Unit 14. Minimal doctor, docs and decision records (AC15)

Goal: `moonbase1 doctor` says what start decided and why a source is or is not reporting. D24. Then the documents catch up.

- Files: `cli/doctor.mjs` (new), `server/hooks/events.mjs` and `server/hooks/live.mjs` (`diagnose()`), `README.md`, `docs/features/moon-base/spec.md`.
- Tests first: `test/cli-doctor.test.mjs`, against temp dirs and an injected clock:
  - every reason string is produced by a fixture (missing, unreadable, refused for permissions, switched off, quiet for over 10 minutes, reporting);
  - the environment lines for inside and outside cmux;
  - a running copy found through `/api/identity`;
  - build fresh, stale and missing;
  - the output never contains the fixture's sentinel content and never an env value, and the exit code is 0.
- README: a Start section (`npm link` once, then `moonbase1`; the alias fallback; `npm run moon-base -- <command>` still works), the two new env vars in the settings table, and "Working from a terminal" simplified to start with `moonbase1`.
- Spec: mark Q1 to Q3 resolved with the decisions above, keep the PATH part of Q4 open until M8, and update Current Behavior once the units are built.
- Decision records to capture with `aw-capture` (immutable): D20 and D21 with D22 (how `moonbase1` starts), D23 (the `auto` default), and D18 with D19 if the off switch or the read window is questioned later. The privacy and layering decision for the cmux source already exists.
- Ticket hint: "moonbase1 doctor and docs". Depends on Units 11 and 13.

### Unit 15. Acceptance run at work (needs the user, on the work machine)

Manual checks, each with recorded evidence; nothing here can be run from the personal machine.

- **M7 (AC14).** In a cmux terminal, run `moonbase1`, then a Claude session. Check that `~/.cmuxterm/workstream.jsonl` fills, that `moonbase1 doctor` says cmux is reporting, that a prompt turns the bot to running within about three seconds, that a permission request or a question shows awaiting input and clears after the answer, and that stop shows finished. Set `MOON_BASE_CMUX_STATUS=off` and check the chip drops cmux. Record whether the file is rotated or cleared over a day (Q2), and any Codex rows if Codex is used there. This also settles whether cmux's hooks fire under the work machine's managed settings, which is the assumption AC14 rests on.
- **M8 (AC15).** Check whether `npm link` works at work, or use the alias. Run `moonbase1` from a cmux tab (launcher on, no env var, first load on Terminal), from a normal terminal (launcher off, copy works), and with a copy already running from `npm run dev` (reused, not duplicated).
- **M9 (AC14, AC15).** Look at the chip in each state and at the Automatic option in Settings.

### Unit 16. Resume without cmux's hooks (AC13, doctor wording; added 2026-09-26)

Goal: Resume does not start a second process on a session that is already running, even when cmux's Claude Code integration is off and its record is empty. The doctor says so plainly. D25 to D27.

- Files: `server/harnesses/claude-code.mjs` (marker gains `cli`, `sessionRunning`), `server/scan.mjs` (`sessionRunning`), `server/harnesses/README.md` (the optional method), `server/api.mjs` (`setRunningProbe`, the launch route asks both), `server/lib/terminal.mjs` (`cmuxSessionsSummary`), `cli/doctor.mjs`, `src/game/open-mode.js` (`launchNote`), `src/main.js`, `test/support/with-server.mjs` (default probe), `README.md`.
- Tests first (acceptance-first), each mapped to the AC13 bullet above:
  - `test/harness.test.mjs`: `sessionRunning` is true for a live terminal marker with that id; false for a desktop-app marker, a gone pid, another id, a malformed id and a marker with no session id; a live desktop marker newer than a live terminal one still counts.
  - `test/terminal-handoff.test.mjs`: cmux says no and the marker says yes, so nothing is launched, cmux is brought forward and the answer carries `via: 'claude'`; cmux says yes, so the answer is unchanged and has no `via`; neither, so it launches; the marker probe throwing or answering oddly never blocks a launch; a new session never asks it; copy mode never asks it.
  - `test/terminal-lib.test.mjs`: `cmuxSessionsSummary` counts the sessions, answers zero for an empty list, and reads a missing command, an error, junk and a changed shape as not answering, with a fixed argument list and no ids or paths in the result.
  - `test/cli-doctor.test.mjs`: the missing stream says the integration, not "is cmux installed"; the Resume check row for cmux knowing sessions, cmux answering with none, and cmux not answering; counts only, with sentinel ids and folders never printed.
  - `test/open-mode.test.mjs`: `launchNote`.
  - `test/open-security.test.mjs`: still exactly three files import `child_process`, and `cmux sessions` is run by an argument list.
- Mutation checks: drop the desktop-app exclusion, drop the pid probe, ask only cmux, ask only the marker, let an error block a launch, add `via` to the cmux answer, ask for a new session, drop the count-only rule, restore the old stream wording.
- Real check on the personal machine: the marker path against a real terminal session's marker (its `entrypoint` is `cli`) with cmux's answer bypassed, and against this machine's desktop-app markers, which must not count.
- **M10 (AC13, at work).** In a cmux terminal with a Claude session running that Moon Base shows, click Resume: expect "Already running" and no new workspace. Close that session and click again: expect a new workspace. Run `moonbase1 doctor` and read the Resume check row and the Claude markers row.

### Unit 17. Bring cmux to the front (AC13; added 2026-09-26)

Goal: one choice under `Open sessions with` that only brings cmux forward. D28.

- Files: `server/api.mjs` (`POST /api/terminal-foreground`), `server/lib/terminal.mjs` (`runForeground` resolves `{ ok }`), `src/game/open-mode.js` (`foreground`, `foregroundNote`), `src/game/api.js`, `src/main.js`, `src/ui/hud.js`, `README.md`.
- Tests first (acceptance-first):
  - `test/terminal-handoff.test.mjs`: exactly `open -a cmux` and nothing launched, opened or asked; nothing in the request is read; refused without the launcher; a malformed body is refused like the other routes; cross-origin and origin-less POSTs refused; only a POST is an action; a failure, from a reporting or a throwing runner, is told in one fixed sentence; where it cannot be done it says so and runs nothing.
  - `test/terminal-lib.test.mjs`: `runForeground` reports `{ ok }` for success, error and throw.
  - `test/open-mode.test.mjs`: the mode is offered, is honoured only with a launcher, is stored and kept, and `foregroundNote`.
  - `test/open-security.test.mjs`: unchanged and still passing, which is the check that no second `open` was added.
- Mutation checks: skip the launcher rule, the platform rule, the failure report (both forms), the body read, the POST-only rule, the answer's shape, the fixed failure words, the honest `runForeground`, the copy fallback, the mode list and the note.
- What tests cannot see: the page half (`main.js`, `hud.js`). It was checked in a real browser on the personal machine: the option and its label, the Open button reading "Show" with its tooltip, the new-thread tooltips, and then a real click, which sent `POST /api/terminal-foreground` (200) and made cmux the frontmost application. That check also found the option's first label made the settings select 88px wider than its row and broke the panel, so the label was measured and shortened to the width of the old longest one.
- **M11 (AC13, at work).** Choose "Bring cmux to the front" (start with `moonbase1` inside cmux), click a bot, and expect cmux to come forward and no new workspace.

## Terminal responsiveness addition (AC16)

Requested after confirming cmux `read-screen` prints a Claude session at work. No hooks or desktop app can be assumed. This reversible, opt-in display feature follows acceptance-first; `docs/standards/index.yml` is empty. Prior units above are historical; this addition does not reopen them.

### Unit 18. Transcript evidence and polling

- Parse a bounded transcript tail into timestamped state, retaining unresolved interactive calls by id until answered. Separate completed turns from intermediate assistant text; a busy marker still protects genuinely running work.
- Combine transcript, marker and event timestamps, preserving newer events and new-turn markers. Keep waiting sessions detectable beyond the old thirty-minute freshness window while their terminal process lives.
- A live terminal process selects the existing three-second polling cadence even if no hooks report. Do not label file inference as live hook reporting.
- Files: `server/harnesses/claude-code.mjs`, `server/hooks/live.mjs`, `src/main.js`, `src/game/poll-interval.js`.
- Tests before implementation: `test/terminal-status.test.mjs`, `test/live-layers.test.mjs`, `test/poll-interval.test.mjs`: unmatched questions/plans, partial and matching results, new prompts, intermediate text, old/new busy stamps, idle markers, dead processes, long waits, and poll cadence without events.

### Unit 19. Optional cmux screen evidence

- Use `cmux --json top --all --processes` for exact live PID-to-surface matching, using the same process-tree fields as cmux's own CLI. This avoids hook registries and manual mappings. Match UUIDs only; skip ambiguity, including multiple Claude processes in one pane.
- Read visible text with explicit workspace/surface ids. No focus, input, scrollback, shell, or request-controlled command. Keep subprocess execution in `server/lib/terminal.mjs`; parse and discard text in `server/status/cmux-screen.mjs`.
- Opt in with `MOON_BASE_CMUX_SCREEN=on`. Fixed timeout/output limits, bounded batches with fair rotation for many panes, coalesced concurrent scans, and short-lived status-only cache. Failure discards evidence and falls back. Only the active dialog footer plus selected numbered option signals a wait; ordinary quotes and old scrollback do not.
- Files: the two modules above, `server/scan.mjs`, `cli/doctor.mjs`, `src/game/live-chip.js`. Tests: `test/cmux-screen.test.mjs`, `test/terminal-lib.test.mjs`, `test/live-api.test.mjs`, `test/cli-doctor.test.mjs`, `test/live-chip.test.mjs`.
- Scenarios: exact mapping across multiple workspaces, same cwd/different sessions, duplicates, missing cmux/socket, malformed tree, disabled mode makes no calls, output limits/timeouts, recognized/unknown prompts, answer clears evidence, sentinel content absent from status and diagnostics, fixed argument lists with no focus commands.

### Unit 20. Verification and handoff

- Update README with opt-in startup, source distinctions, restart requirement for an already running server, and limits. Add immutable decision for opt-in screen reading, supplementing the socket-free event-stream decision.
- Run focused tests, full `npm test`, build, review and workflow compliance. Verify new chip text in a browser when practical. The user subsequently requested committing and pushing directly to main.
- Manual work-machine checkpoint M12: background reads do not switch focus; questions, plans, permissions and answers update the correct bot; multiple panes of the same repo remain distinct. cmux refuses socket access from the implementation environment because it is outside cmux's process tree; do not claim M12 passed from mocked tests. Prompt recognition is conservative and version-dependent.
- Deferred: input/approval automation, remote sessions, generic terminal scraping and guarantees for every Claude terminal layout.

### AC16 verification and handoff evidence

Implementation and automated verification for Units 18–20 are complete. The plan remains active for the real-machine checks, including M12; none of those is claimed complete by fixtures.

- Acceptance-first: transcript/poll tests failed on the old implementation before changes. Screen integration, command limits, opt-in behavior, ambiguous binding, answer/failure clearing, batched reads, privacy, doctor and chip have automated coverage in the files above.
- Full suite: 528 tests pass with loopback access. The initial sandbox run denied local HTTP sockets; rerunning with that access resolved the environment failures. Focused checks were rerun after the final chip wording and scan fallback edits.
- Production build passes; Vite still warns about its large bundle. Spec trace and whitespace checks pass.
- Mutation checks: matching-answer removal, bypassing newer evidence, bypassing opt-in, and accepting ambiguous pane matches each cause a named regression test to fail. Original source bytes restored afterwards. Other new assertions were not mutation-tested.
- Browser: app loads without console errors; screen-unavailable indicator renders. Its first combined label overflowed by four pixels; shortening it fixed the observed layout. Real cmux listing from outside its process tree was refused. No access settings were changed and no real terminal prompt was read.
- Review: correctness, tests, maintainability, security/privacy, performance, API compatibility, frontend concurrency and project standards checked sequentially. Fixed possible overlapping reads from distinct concurrent scans and the chip overflow. No remaining actionable findings; conservative prompt recognition and M12 remain limitations.
- README includes opt-in start/restart instructions, diagnosis and limits. The immutable screen-status decision is linked from the spec/index. Workflow review/compliance completed as local readiness checks before the user's subsequent request to commit and push directly to main; no PR requested.

## Test Plan

- Unit tests and fixtures are in the paths above and run with `npm test` (`node --test "test/**/*.test.mjs"`).
- Acceptance-first: each unit's tests are written from its AC rows before implementation.
- Manual checks M1 to M5 (Unit 8) cover what needs real apps: live hook timing, real URL schemes, real network behavior, and visual identity.
- No test reads real `~/.claude`, `~/.codex`, `~/.moon-base` or `~/.cmuxterm`. All use a temp HOME, and cmux fixtures are written with `MOON_BASE_CMUX_DIR`.
- Units 11 to 17 (AC13 to AC15) follow the same policy: tests from the AC examples first, watched failing, then the code. Every rule listed under a unit's mutation checks is removed once and the named test must fail; any test that still passes means the test is wrong, not the rule.
- Manual checks for the v2 slice are M7 to M9 (Unit 15), on the work machine, because they need cmux's hooks, `npm link` permissions and the real stream there.

## Risks and Open Questions

- **Bot art is the largest schedule and taste risk.** Mitigated by the Unit 7 concept checkpoint and the CC0-base approach.
- **Hook overhead.** Every event starts a Node process. Async plus a minimal event set (D8) limits it, and Unit 1 measures it. If too heavy, batch through a persistent process.
- **Concurrent writes to `~/.claude/settings.json`.** Handled by the changed-since-read check (Unit 6).
- **Codex trust by hash.** A changed command string forces re-trust, so D7 keeps it constant. Unit 1 check 5 confirms the assumption.
- **Absolute Node path in hooks.** An nvm path breaks when the Node version changes. Unit 1 check 3 decides between an absolute path and PATH lookup.
- **Undocumented URL paths and session stores can change with app updates.** URL building and store parsing stay isolated in the adapters, with `diagnostic()` output and fixture tests, so drift shows as a clear message.
- **A stale marker can hold Resume back (AC13, D26).** If Claude died without removing its marker and the pid was since reused by another process of the same user, Resume reads the session as running. Copy mode still works. Closing it properly needs a process-start check, deferred with the reason in D26.
- **Spoofed events.** Same-user processes can forge display state (D3, D4). Documented, not defended.
- **High-Risk workflow gates.** Per `AGENTS.md`, this needs review evidence, and `human_review.spec.reviewers` and `human_review.plan.reviewers` are empty. A remote (`origin`) exists now, but nothing is configured to review a PR. Before any PR you must either configure reviewers, or accept the risk explicitly. Unit 11 (reading another app's private files that hold message content) is the part that most needs it.
- **Unverified assumption:** docs-derived hook event lists and upstream URL strings are not yet observed live (Unit 1).
- **cmux's format can change (AC14).** `cmux-feed-v1` is undocumented and version-dependent. It gets one parser, fixtures with the real shape, and a doctor reason, so a change reads as "cmux not reporting" and never as an error, and the files still decide.
- **Whether cmux's hooks fire at work is the assumption AC14 rests on.** The person confirmed cmux shows agent status there, but the stream file has only been seen on the personal machine. If it is empty at work (M7), AC14 shrinks to Claude's busy/idle marker, and the fallback is to read cmux's events over its socket instead, which ties live status to being started inside cmux. That would be a new decision, not a quiet change.
- **Message content is in the rows.** Rows carry prompts, tool inputs and results. The parser drops everything but five fields as soon as the row is parsed; the parsed object is transient in memory only. Nothing logs a row, the doctor prints kinds, counts and ages, and a sentinel test runs through the parser, the API responses and the doctor output.
- **Oversized rows.** A row over 512 KiB is skipped, so an event can be lost. The next event corrects the state, and every state expires to the files anyway.
- **A stale `busy` marker.** A crashed process leaves a marker behind, and a pid can be reused. The existing liveness check (`kill -0`) applies before a marker counts, and a reused pid could still read as busy until it exits. Accepted; noted for the doctor.
- **cmux timestamps are whole seconds.** A row is up to a second older than what it describes. Within one file that is harmless, but when hooks and cmux both report a session, two events less than a second apart can be ranked either way by newest-wins (D15), leaving a state briefly wrong until the next event. Accepted, and noted in `server/hooks/cmux.mjs`; there is no millisecond time to use.
- **In-process start (D21).** `serve()` runs inside the `moonbase1` process, so a crash there ends the command. That is what a foreground server does anyway, and it is what keeps the server inside the cmux terminal's process tree. Review found that one malformed request line could crash it (an unhandled rejection from `new URL`); the handler and the API middleware now answer 400 instead, with tests that send such lines.
- **Open, carried to a checkpoint:** whether `npm link` is allowed on the work machine (Q4, M8), and how cmux rotates or clears `workstream.jsonl` (Q2, M7).

## Deferred Work

- Linux and Windows support.
- More tools, and terminal launchers other than cmux (Terminal.app, iTerm2, Ghostty, tmux).
- Steering or sending input to a running session.
- Sound design, planet variety beyond the lunar default, and mascot variants.
- A cadence and tooling for pulling upstream changes.
- Always-on start (a menu-bar app or login item). Dropped on 2026-09-26 and now a spec non-goal. The cmux launcher only works when Moon Base is started inside cmux (its socket accepts only its own child processes), so an always-on server would be viewer plus copy-command only. A lead if it comes back: cmux's socket password auth.
- The rest of v2, in `docs/brainstorms/2026-09-26-001-v2-roadmap-idea.md`: the cross-repo needs-you view, insight on the card (what the agent last said or asked, a "today" timeline, a PR link read from Claude transcripts), a fuller doctor, and sound, mascot and planet polish. The village or farm theme is parked there too.
- Focusing an already-open session's own cmux workspace (no cmux command for it was found).

## Handoff

Units 11 to 15 are the v2 additions for AC14 and AC15. Recommended next step: `aw-work docs/features/moon-base/plan.md`, beginning at Unit 11 (the data foundation). Alternatively run `aw-create-tickets docs/features/moon-base/plan.md`; the units are independently reviewable and sequenced: 11 first; 12 after 11 (it needs the `summary()` shape); 13 is independent of 11 and 12 and can run in parallel; 14 after 11 and 13; 15 last, on the work machine. Units 1 to 10 are the earlier plan and are unchanged.
