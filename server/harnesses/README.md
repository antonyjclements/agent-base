# Harness adapters

A **harness** is whatever runs the agent threads you want to see as bots. Moon Base ships two,
Claude Code and Codex, and asks every harness present on the machine for its threads and draws
whatever comes back.

Adding another is meant to be **one new file in this directory**, plus one line in `index.mjs`.
Nothing in `server/scan.mjs`, `server/api.mjs`, or under `src/` should need to change. If you find
yourself editing those to land a harness, that is a bug in this seam.

## The shape of it

```js
// server/harnesses/my-harness.mjs
export default {
  id: 'my-harness',              // stable, kebab-case, used as a key — never change it later
  name: 'My Harness',            // what a human sees in the UI
  detect,                        // () => Promise<boolean>
  scanThreads,                   // () => Promise<Thread[]>
  openThread,                    // (ref) => { ok: true, url } | { ok: false, error }
  newSession,                    // (dir) => { ok: true, url } | { ok: false, error }
  terminalOpen,                  // optional: (ref) => { ok: true, argv, cwd } | { ok: false, error }
  terminalNew,                   // optional: (dir) => { ok: true, argv, cwd } | { ok: false, error }
}
```

Then, in `index.mjs`:

```js
import myHarness from './my-harness.mjs'
export const HARNESSES = [claudeCode, codex, myHarness]
```

### `detect()`

Is this harness on this machine at all? Usually just "does its data directory exist". Cheap: it
runs on every scan, so installing a harness while the colony is open is noticed on the next poll.
Returning `false` skips the harness entirely.

### `scanThreads()`

Return one `Thread` per session the harness knows about. Throwing is survivable: the scanner logs
it and carries on with the other harnesses. Prefer that over returning junk.

### `openThread(ref)` / `newSession(dir)`

Return `{ ok: true, url }`. **That is the whole answer**: the server hands the URL to the OS
opener and nothing else is ever started. There is no `command`, no pid, no terminal, and a test
(`test/harness.test.mjs`) fails if an adapter adds one. If a harness has no deep link, return
`{ ok: false, error: '…' }` and say why, and the UI shows the message.

### `terminalOpen(ref)` / `terminalNew(dir)` (optional)

The same two questions, asked for a terminal instead of a desktop app. Return `{ ok: true, argv, cwd }`:
the program and its arguments as an array (`['claude', '--resume', id]`), and the folder to run it in.
**That is data, not an action.** An adapter never runs anything and never builds a string for a shell.
`server/lib/terminal.mjs` alone turns the answer into a line to paste, or into a launcher's argument
list, and it refuses the whole command unless every token is letters, digits, `.`, `_` or `-`. So put
only fixed words and ids you have already pattern-checked in `argv`, never a title, a path or anything
else read from disk. The folder goes in `cwd`, not in `argv`.

A harness without these two methods answers "That tool has no terminal command", and the page shows that.
`test/terminal-handoff.test.mjs` covers what the two built-in adapters return.

### There is no `setArchived`, and that is deliberate

Moon Base does not write to a harness. Not the transcripts, not the session records, not one flag.
Archiving is recorded in `data/colony.json` and nowhere else. Archiving in the harness's own UI
still works: your adapter reports it through the `archived` field and the bot goes home on the next
poll.

## The `Thread` your adapter returns

Only `id` is truly required, but the colony gets duller the more you leave out. `project` is what
earns a repo its own zone, and `lastActivityAt` is what sorts the whole map.

| Field | Type | What it means |
| --- | --- | --- |
| `id` | string | **Unique across every harness.** Prefix it, e.g. `claude-code:<uuid>`, `codex:<uuid>` |
| `title` | string | Thread title. `'Untitled thread'` if the harness has none |
| `preview` | string | First prompt, trimmed |
| `project` | string | Repo or folder **name**. This is what claims a hex zone |
| `projectPath` | string | Absolute path to the repo root |
| `worktree` | string | Worktree name, or `''` |
| `cwd` | string | Where the thread is actually working |
| `gitBranch` | string | Branch name, or `''` |
| `model` / `effort` | string | Shown on the thread card |
| `createdAt` | number | Epoch ms |
| `lastActivityAt` | number | Epoch ms. Sorts the colony and drives the three-days-dormant state |
| `lastFocusedAt` | number | Epoch ms, `0` if unknowable |
| `running` | boolean | Working **right now** |
| `unread` | boolean | Moved on since you last looked, or waiting on you |
| `hasError` | boolean | Errored |
| `starred` / `routine` / `prState` | | Optional extras; `prState: 'MERGED'` marks a shipped thread |
| `archived` | boolean | Archived in the harness's own records. Read-only |
| `sizeBytes` | number | Transcript size, which sets how finished a building looks (log scale) |
| `source` | string | Free-form bookkeeping (the Claude adapter uses `desktop` / `cli`) |
| `canOpen` | boolean | Whether this thread can be opened |
| `openHint` | string | Optional. Why `canOpen` is false, shown in place of the Open button's hint |
| `opensAsNewSession` | boolean | True when opening would make a new desktop session instead of reopening one (a Claude Code session that only exists in the terminal). The page asks before opening |
| `subagents` | array | Optional. Errands the thread has out right now: `{ id, task, lastActivityAt }` |
| `ref` | object | **Opaque.** Whatever your adapter needs to find this thread again |

## Ground rules

- **Read-only.** A harness's transcripts and records are somebody's actual work. If an adapter
  seems to need a write, it does not.
- **URL schemes, or data for the terminal hand-off.** Opening goes through a URL the OS resolves, or
  through the `{ argv, cwd }` description above. Never spawn a process yourself, and never run anything
  out of another application's bundle.
- **Never block the scan.** It runs on a poll. Cache anything expensive against file mtime; see
  `transcriptMeta` in `claude-code.mjs`.
- **Read heads, not whole files.** `readHead` in `../lib/fsutil.mjs` pulls the first chunk and drops
  a trailing partial line, so `JSON.parse` never sees half a record.
- **Expect malformed data.** A session being written right now is normal. Skip that record and
  move on.
- **Never widen `id` collisions.** The colony keys its archive list and saved layout on `id`.
  Two harnesses handing back the same id would merge two unrelated threads into one bot.

## Where each harness keeps its data

- **Claude Code**: desktop records in
  `~/Library/Application Support/Claude/claude-code-sessions/<account>/<org>/local_*.json`, and in
  the same folder a `deleted_<cliSessionId>` marker for every thread deleted in the app. CLI
  transcripts are in `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` and live processes in
  `~/.claude/sessions/*.json`. `CLAUDE_CONFIG_DIR` (the CLI's own override for `~/.claude`) and
  `MOON_BASE_CLAUDE_DESKTOP` (the session store) point both roots elsewhere, which is how the
  tests fake an install.
- **Codex**: transcripts in `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`, with
  records shaped `{ timestamp, type, payload }`, and thread metadata in the `threads` table of
  `~/.codex/state_5.sqlite`. `CODEX_HOME` points it elsewhere. Without Node 22.13 or newer the
  database is skipped and `diagnostic()` says why.

## Checking your work

The fixtures in `test/support/fixtures.mjs` fake both installs on disk, so no test reads a real one.
`npm test` runs everything. For a new adapter, add fixtures for its store and a test that:

1. lists it in the registry and exposes the interface above;
2. scans a fixture into threads with unique, prefixed ids and skips a malformed record;
3. answers `openThread` and `newSession` with `{ ok, url }` and nothing else.
