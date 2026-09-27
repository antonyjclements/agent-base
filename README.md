# Moon Base

A local 3D colony where every Claude Code and Codex session on your machine is a small survey bot on a lunar
base. Each repo claims a hex plot, each session is a bot that builds on it, and you can see at a glance which
ones are working, which are waiting on you, and which have gone quiet. Click a bot to open its session, or
start a new one in a repo from its zone.

It runs on your machine and only reads the tools' own session files. Nothing is uploaded, there is no
account, and the server answers only your own browser on the same machine.

## Run it

You need Node 22.13 or newer. macOS is the platform it is built and tested on.

```bash
npm install
npm link        # once: puts the moonbase1 command on your PATH
moonbase1
```

`moonbase1` builds the page if there is no build or the source has changed, starts on port 5274 (or the next
free one, or the copy that is already running), and opens the page. Inside a cmux terminal it turns the
terminal launcher on for you (see "Working from a terminal"). `moonbase1 --no-open` does not open the page,
`moonbase1 --port <n>` starts the search for a free port at `n`, and `moonbase1 --help` lists the rest.
`moonbase1 doctor` says what it would decide and whether each live source is reporting; it prints kinds,
counts and ages, never a message, so its output is safe to paste when asking why a bot is missing.

If `npm link` is not allowed on your machine, use an alias, `alias moonbase1='node /path/to/moon-base/bin/moon-base.mjs'`,
or `npm run moon-base --` in place of `moonbase1`.

For working on Moon Base itself, `npm run dev` starts the Vite dev server (open http://localhost:5274; do not
open `index.html` from disk), `npm test` runs the whole test suite, and `npm start` builds the page and serves it.

Your colony layout (which repo sits on which plot, what you archived) is the only thing written, to
`data/colony.json` in this folder. Deleting it resets the map and touches none of your sessions.

## What you see

- One hex plot per repo, and one bot per Claude Code or Codex session on it. Buildings grow with the size of
  the session's transcript.
- Working bots hammer, bots waiting on you stop and hold a question mark, errors get a red alert, and shipped
  work gets a check. Bots with nothing for three days go to sleep.
- **Open** on a thread's card hands it to the tool it came from. A session that only exists in the terminal is
  opened by importing it into the desktop app as a new session, and the page asks before it does that.
- **Claude Code** and **Codex** buttons on a repo's card start a new session in that folder.
- Both of those use the desktop apps by default. If you work in a terminal and have no desktop app, change
  Settings → Sessions → **Open sessions with**; see "Working from a terminal" below.

The bot's design is Moon Base's own. Three looks are built in, chosen with `?look=` on the address:
`rover` (the default), `lantern` and `dish`. `http://localhost:5274/tools/look-lineup.html` shows them side by side.

## Working from a terminal

The colony works as a viewer without any desktop app, because it only reads the tools' session files. What
needs the desktop apps is **Open** and the new-thread buttons, which use their `claude://` and `codex://`
links. On a machine without them, open Settings → Sessions → **Open sessions with** and pick one of:

- **Copy terminal command**: Open puts one line on your clipboard, such as
  `cd '/path/to/repo' && claude --resume <session id>` (or `codex resume <id>`), and the new-thread buttons copy
  `cd '/path/to/repo' && claude` (or `codex`). Paste it into any terminal. Nothing is started.
- **Terminal (cmux)**: Open resumes the session in a new [cmux](https://cmux.com) workspace in that folder. If
  that session is already open in cmux, nothing new is started — the toast says so — because two resumes of
  the same session would race the one transcript file they both write. Either way, Moon Base also brings the
  cmux app itself to the front, since cmux's own "focus" only selects a workspace inside its window and does
  not raise the app over whatever else is in front.
  Moon Base asks two things whether a session is already open. One is cmux's own record, which cmux fills
  through its **Claude Code integration**. If that setting is off in cmux (it is on by default), the record is
  empty and would never say "already open". So for Claude Code Moon Base also asks Claude's own record of its
  running processes (`~/.claude/sessions`), which needs no hooks: a live terminal session with that id also
  counts, and the toast then says "Already running" without naming a terminal, since that record cannot say
  which one. A session the Claude desktop app is holding warm does not count. Codex has no such record, so
  Codex resume relies on cmux's. If a stale record ever holds a Resume back, **Copy terminal command** always
  works, and `moonbase1 doctor` shows what each check sees.
  With Automatic, the default, this is what you get when Moon Base was started **inside a cmux terminal**:
  `moonbase1` turns the launcher on there by itself. To do it by hand, start Moon Base from a cmux terminal
  with `MOON_BASE_TERMINAL=cmux`:

  ```bash
  MOON_BASE_TERMINAL=cmux npm run dev
  ```

  cmux only accepts requests from processes started inside it, so the same command from another terminal is
  refused, and the page says so. The `cmux` command also has to be on the server's `PATH`, which it should be
  inside cmux; if not, link `/Applications/cmux.app/Contents/Resources/bin/cmux` into a folder on your `PATH`.
  Until it is on, a stored "Terminal" choice copies the command instead.

- **Bring cmux to the front**: Open and the new-thread buttons do one thing, bring the cmux app to the front (macOS),
  and nothing else. No resume, no new workspace, no check for a running session. It is for when your sessions
  already run in cmux and you only want to get to them; cmux cannot be told which workspace to show, so you pick
  it there. The Open button reads "Show". It needs the launcher on, like Terminal, and copies instead without it.

cmux is the only launcher for now. Any other terminal (Terminal.app, iTerm2, Ghostty, tmux) works through the
copy option. The command is POSIX shell, so this is for macOS and Linux. Resuming in a terminal does not import a
terminal-only Claude session into the desktop app, so the import warning does not apply.

## Live status without hooks

If you run Claude Code in cmux, you get live status with nothing installed (and Codex too, wherever cmux reports
its sessions, which so far is thinly). Moon Base reads two things the tools already write:

- **cmux's own event stream**, `~/.cmuxterm/workstream.jsonl`: a prompt or tool call turns a bot to running, a
  permission request or a question shows it awaiting you, and a stop shows it finished.
- **Claude Code's own busy/idle marker**, `~/.claude/sessions/<pid>.json`, which says a session is mid-turn.

The Live chip names cmux while its stream is reporting (● reporting, ○ present but quiet). When cmux's stream is
there but has said nothing for ten minutes and nothing else is reporting, the chip stays up as `cmux ○` rather than
disappearing, so an empty stream is visible instead of just looking like nothing is happening. From cmux's rows
Moon Base reads only the event kind, the session id, the folder and the time. The rows also hold what you
typed and what the tools returned, and none of that is kept, logged, shown or sent anywhere. Nothing is
written to cmux's files or to any tool's config, and the cmux socket is not used, so it works however Moon
Base was started. To stop reading the stream, start Moon Base with `MOON_BASE_CMUX_STATUS=off`.

If a bot is not live when you expect it to be, `moonbase1 doctor` says which source is reporting and why any
other is not.

## Live status with hooks (optional)

Out of the box, status is inferred from the tools' session files, which can lag. Hooks make it live, so a
bot changes state within about three seconds, including "waiting on a permission". They are opt-in and
reversible:

```bash
npm run moon-base -- install-hooks --dry-run   # show exactly what would change, write nothing
npm run moon-base -- install-hooks             # show it again, and ask before each tool
npm run moon-base -- hooks-status              # what is installed, and whether events are arriving
npm run moon-base -- uninstall-hooks           # remove exactly what was added
```

- Every change is shown as a diff and asked about, tool by tool. There is no flag to skip the question, and it
  refuses without a terminal.
- Your own entries are left where they are; Moon Base only appends after them, and uninstalling gives back the
  exact bytes you had. It never touches Codex's `notify` setting or `config.toml`.
- **Codex will not run the new hooks until you trust them.** Start Codex, run `/hooks`, and trust the Moon Base
  entries. Until then Codex status is inferred from its files, and `hooks-status` says so.
- The hook records only which tool, which event and which session. It never records a prompt, a command, a
  reply or a file path, and it writes to `~/.moon-base/events/`, readable by your user alone.
- When hooks stop reporting, or you uninstall them, status falls back to the files with nothing to do.

## Safety

- The server listens on your own machine only, and answers only requests that carry its own page's Host and
  Origin, which stops other websites from driving it.
- The only thing it starts is your OS opener, with a `claude://` or `codex://` link, and, only if you started
  it with `MOON_BASE_TERMINAL=cmux`, the `cmux` command. A request cannot name a command, a program or a
  launcher: a thread is looked up by id in the server's own scan, and a new session can only start in a folder
  that a known thread already lives in.
- A terminal command is built only from the tool's name, `resume`/`--resume` and a session id that is checked to
  be a UUID, and every piece must be letters, digits, `.`, `_` or `-`. The folder is quoted for the pasted line
  and passed to cmux as its own argument, and a folder name containing a control character is refused. cmux is
  started without a shell, and its own error text is never sent to the page.
- Reading cmux's event stream is read-only and metadata-only (see "Live status without hooks"), and can be
  switched off. Moon Base never writes to it, renames it, or keeps a row's content.
- Only the hook installer ever writes to a tool's config, and only after you confirm the diff. The server and
  the page cannot.
- A process running as you could forge hook events. That can only change how a bot that already exists looks;
  it cannot add one or trigger anything. It is the same trust boundary as your session files.

## Settings

| Variable | What it does |
| --- | --- |
| `PORT` | The dev server's port (default 5274). |
| `MOON_BASE_HOST` | The address `npm start` binds to (default loopback). Anything else exposes thread titles, paths and the ability to open threads to that network, with no login. |
| `MOON_BASE_DATA` | Where `colony.json` is kept. |
| `MOON_BASE_HOME` | Where the hooks and their events live (default `~/.moon-base`). |
| `MOON_BASE_CMUX_STATUS` | Set to `off` (or `0`, `false`, `no`) to stop Moon Base reading cmux's own event stream for live status. Anything else leaves it on. |
| `MOON_BASE_CMUX_DIR` | Where cmux keeps its stream, if it is not in `~/.cmuxterm`. |
| `MOON_BASE_TERMINAL` | Set to `cmux` to let Open and the new-thread buttons open a cmux workspace. Anything else does nothing. Start Moon Base from a cmux terminal (see above). |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME` | Where to find each tool's data, if it is not in its usual place. |
| `MOON_BASE_CLAUDE_DESKTOP` | Where Claude's desktop app keeps its session records. |

## Layout

- `server/`: the scanner, the API, and the two adapters in `server/harnesses/` (see the README there).
- `src/`: the page: the colony, the bots, the HUD.
- `hooks/` and `bin/`: the hook script and the installer. Nothing under `server/` can reach these.
- `tools/`: the asset builders and visual checks.
- `test/`: the tests, all against fixtures. None reads a real home directory.
- `docs/`: the feature spec, plan, decisions and learnings.

## Art

Every model is built from CC0 packs by Kay Lousberg (KayKit) and Kenney. The raw packs are not checked in;
the built models are, so a fresh clone runs. `public/assets/CREDITS.md` has the sources, versions and hashes,
and explains how to rebuild them with `npm run assets`.

## Credits

Moon Base is based on [Bot Crossing](https://github.com/Station-Sciences/bot-crossing) by Jarren Rocks, which
is MIT licensed, and is not endorsed or maintained by that project. See `UPSTREAM.md` for the exact commit that
was imported and what was kept or left out.

## License

MIT. See `LICENSE`.
