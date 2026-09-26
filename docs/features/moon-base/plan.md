---
status: active
created: 2026-09-25
origin: docs/features/moon-base/spec.md
depth: deep
---

# Moon Base Implementation Plan

## Problem and Scope

Deliver the Moon Base living spec ([spec](spec.md)): a local colony view of Claude Code and Codex sessions, forked from Bot Crossing (MIT, upstream commit `d05ac2ffad9fce3d68e29ab446fce99b7123847b`, 2026-09-18), with its own theme and original bot, opt-in live status hooks, and URL-scheme controls by default, with an opt-in terminal hand-off (Unit 10).

In scope: everything in the spec's Acceptance Criteria AC1 to AC13.
Out of scope: the spec's Boundaries and Non-Goals, plus the Deferred Work below.

Assumptions:
- macOS is the only platform we test and claim. Inherited Windows and Linux helper code stays but is unclaimed.
- Node 22.13 or newer. Local is v22.22.0.
- Upstream's session-store layouts and URL paths were observed to work on this machine (see the spec's spike findings). The items still unverified are listed in the spec's Still open section.
- No git repo or remote exists yet, so PR and CI steps in the workflow cannot run until one is created.

Dependencies: Claude.app (`claude://`), ChatGPT.app (`codex://`), Claude Code 2.1.x, Codex CLI 0.157.x, three CC0 asset sources (fetched at execution), and upstream's MIT code.

## Requirements Traceability

| Spec item | Units | Verified by |
|---|---|---|
| AC1 both tools discovered, unique prefixed IDs | 3 | `test/scan-harnesses.test.mjs`, `test/support/fixtures.mjs` |
| AC2 status precedence | 3, 5 | `test/status-precedence.test.mjs` |
| AC3 read-only toward session data | 3, 4, 5 | `test/readonly-guard.test.mjs` |
| AC4 local-only | 3, 4 | `test/open-security.test.mjs`, manual check M4 |
| AC5 hooks opt-in and reversible | 6 | `test/hooks-install.test.mjs` |
| AC6 live status per tool | 1, 5 | `test/hook-script.test.mjs`, `test/hook-events.test.mjs`, `test/live-api.test.mjs`, manual check M2 |
| AC7 graceful fallback | 5 | `test/hook-events.test.mjs`, `test/live-api.test.mjs` |
| AC8 URL schemes by default | 1, 4, 10 | `test/open.test.mjs`, `test/open-security.test.mjs`, manual check M3 |
| AC9 own identity | 2, 7 | `test/identity.test.mjs`, manual check M5 |
| AC10 art licensing | 7 | `test/identity.test.mjs` |
| AC11 attribution and license | 2 | `test/identity.test.mjs` |
| AC12 only two adapters | 2, 3 | `test/identity.test.mjs` |
| AC13 terminal hand-off, opt-in | 10 | `test/terminal-handoff.test.mjs`, `test/terminal-lib.test.mjs`, `test/open-mode.test.mjs`, `test/open-security.test.mjs`, manual check M6 |

Test policy is `acceptance-first` (`docs/workflow/config.yml`): in every unit, write the acceptance tests from the table above first, watch them fail, then implement.

## Relevant Existing Patterns

No local code yet, and `docs/standards/index.yml`, `docs/decisions/index.yml` and `docs/learnings/index.yml` are empty, so no standards apply. Patterns to keep from upstream, which are what the fork brings in:

- Adapters in `server/harnesses/` are read-only, cache against file mtimes, read file heads through `server/lib/fsutil.mjs`, skip malformed records, and expose `diagnostic()`.
- `server/scan.mjs` merges adapter output into one thread list. `server/api.mjs` serves it with loopback binding and Host/Origin checks.
- Tests use `node --test` with `test/support/with-server.mjs` and `test/support/env.mjs` for a fake HOME.
- Thread IDs are prefixed `claude-code:<uuid>` and `codex:<uuid>`.

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
- **M6.** From a cmux terminal, run `MOON_BASE_TERMINAL=cmux npm run dev`. In settings choose `Open sessions with: Terminal (cmux)`, then Open a Claude Code bot, Open a Codex bot, and start a new session from a zone. Each should make a cmux workspace in the right folder running the right command. Then run the server from a normal terminal and confirm the page shows the fixed "not started inside cmux" message. Also record the questions in the spec's Still open (whether `cmux` is on PATH, whether `claude` and `codex` are found by the `--command` shell, focus, what happens when the tool exits). The second half, from a normal terminal, is already covered: it was checked against the real binary on 2026-09-26. (AC13)

### Unit 9. Docs and workflow close-out

- Files: `README.md` (macOS-only claim, setup, hooks install and uninstall, security notes including that any process running as you can forge status, attribution), `docs/features/moon-base/spec.md` (Current Behavior, updated), `docs/workflow/config.yml` (add `*.test.mjs` to `trace.test_paths` so acceptance-to-test tracing sees these tests).
- Capture the four spec decisions plus D2 to D8 as immutable decision records with `aw-capture`.
- Run `aw-review` and `aw-check-workflow-compliance`, and satisfy the configured gates (`review`, `capture`, `check_workflow_compliance`) before any commit or PR.

### Unit 10. Terminal hand-off (added 2026-09-26)

Goal: AC13, so Moon Base is usable where the desktop apps are not installed (cmux at work). High-Risk under `AGENTS.md`: it changes AC8, which was a security boundary, so the spec and a decision record were updated first (done), and review evidence is still owed before any PR.

- Files: `server/lib/terminal.mjs` (new), `server/harnesses/claude-code.mjs`, `server/harnesses/codex.mjs`, `server/harnesses/README.md`, `server/scan.mjs`, `server/api.mjs`, `src/game/api.js`, `src/game/open-mode.js` (new, pure so it can be tested), `src/core/settings.js`, `src/ui/hud.js`, `src/main.js`, `README.md`, and the tests below.
- Behavior: the routes in D11. Every route sits behind the existing Host and Origin checks. The thread or folder must come from the server's own scan, as in Unit 4. The cwd for a resume is the thread's own recorded folder and must still be a directory.
- Tests first (acceptance-first): `test/terminal-handoff.test.mjs` (both routes end to end with the launcher faked: exact command strings for both tools and for new sessions, a hostile folder name, refusal of unknown ids, folders, harnesses and control characters, ignored request fields, launcher off by default and for any unknown value, exact `cmux` argument list, launcher errors passed through as fixed messages, cross-origin refusal), `test/terminal-lib.test.mjs` (token allow-list, `shellQuote` round-trips through a real `sh`, error mapping with a fake `execFile`), `test/open-mode.test.mjs` (mode fallback), and an update to `test/open-security.test.mjs` (the list of files allowed to import `child_process`, and a scan that `terminal.mjs` never uses a shell).
- Mutation checks (see the learning on regression tests): remove the token allow-list, the env gate, the control-character refusal and the quoting one at a time, and confirm the matching test fails each time.
- Edge cases: a CLI-only Claude thread (no desktop record) resumes fine; a thread whose folder was deleted is refused with a message; a thread with no folder on record is refused; a Claude desktop record with no CLI id has nothing to resume.
- Not done here: running against a live cmux (manual check M6).

## Test Plan

- Unit tests and fixtures are in the paths above and run with `npm test` (`node --test "test/**/*.test.mjs"`).
- Acceptance-first: each unit's tests are written from its AC rows before implementation.
- Manual checks M1 to M5 (Unit 8) cover what needs real apps: live hook timing, real URL schemes, real network behavior, and visual identity.
- No test reads real `~/.claude`, `~/.codex` or `~/.moon-base`. All use a temp HOME.

## Risks and Open Questions

- **Bot art is the largest schedule and taste risk.** Mitigated by the Unit 7 concept checkpoint and the CC0-base approach.
- **Hook overhead.** Every event starts a Node process. Async plus a minimal event set (D8) limits it, and Unit 1 measures it. If too heavy, batch through a persistent process.
- **Concurrent writes to `~/.claude/settings.json`.** Handled by the changed-since-read check (Unit 6).
- **Codex trust by hash.** A changed command string forces re-trust, so D7 keeps it constant. Unit 1 check 5 confirms the assumption.
- **Absolute Node path in hooks.** An nvm path breaks when the Node version changes. Unit 1 check 3 decides between an absolute path and PATH lookup.
- **Undocumented URL paths and session stores can change with app updates.** URL building and store parsing stay isolated in the adapters, with `diagnostic()` output and fixture tests, so drift shows as a clear message.
- **Spoofed events.** Same-user processes can forge display state (D3, D4). Documented, not defended.
- **High-Risk workflow gates.** Per `AGENTS.md`, this needs review evidence, and `human_review.spec.reviewers` and `human_review.plan.reviewers` are empty. There is also no git remote for a review PR. Before any PR you must either configure reviewers, or accept the risk explicitly.
- **Unverified assumption:** docs-derived hook event lists and upstream URL strings are not yet observed live (Unit 1).

## Deferred Work

- Linux and Windows support.
- More tools, and terminal launchers other than cmux (Terminal.app, iTerm2, Ghostty, tmux).
- Steering or sending input to a running session.
- Sound design, planet variety beyond the lunar default, and mascot variants.
- A cadence and tooling for pulling upstream changes.
- Packaging as a menu-bar app or login item.

## Handoff

Start with Unit 1 once you give the go-ahead. Recommended next step: `aw-work docs/features/moon-base/plan.md`, beginning at Unit 1. Alternatively run `aw-create-tickets docs/features/moon-base/plan.md`; the units are independently reviewable and sequenced (1, 2, 3, then 4, 5 and 7 in any order, 6 after 5, then 8 and 9).
