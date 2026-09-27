/**
 * Terminal hand-off (AC13): the one place a terminal command is checked, quoted and, when a
 * launcher is switched on, run.
 *
 * An adapter describes a command as data (`{ argv, cwd }`) and never runs anything. Everything
 * that reaches a shell or a launcher passes through here, and two rules keep it from carrying
 * shell syntax:
 *
 *   - Every argument token must match TOKEN: letters, digits, `.`, `_` and `-`. That is enough for
 *     `claude`, `--resume` and a UUID, and it leaves no room for a space, a quote, a `$`, a
 *     backtick, a `;`, a newline or a path separator.
 *   - The folder is never part of the command. It is single-quoted in a line a person pastes, and
 *     it is its own argument to a launcher. A folder with a control character in its name is
 *     refused for both, because a newline inside a paste is a second command.
 *
 * The launcher is chosen by the server's environment (`MOON_BASE_TERMINAL`), never by a request,
 * and is a fixed table: an unknown value enables nothing. It is started with `execFile`, an
 * argument list with no shell, and only the program name on the server's own PATH is used.
 *
 * The line a person pastes is POSIX shell, so this is macOS and Linux only.
 */
import { execFile } from 'node:child_process'
import path from 'node:path'

const TOKEN = /^[A-Za-z0-9._-]{1,128}$/
const MAX_TOKENS = 8
const MAX_CWD = 1024
// C0 and C1 controls, and DEL. Tab counts: a tab in a paste can trigger completion.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** The command as one string, or null when any token could carry shell syntax. */
export function commandLine(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > MAX_TOKENS) return null
  for (const token of argv) if (typeof token !== 'string' || !TOKEN.test(token)) return null
  return argv.join(' ')
}

function folderOk(cwd) {
  return typeof cwd === 'string' && cwd.length > 0 && cwd.length <= MAX_CWD && path.posix.isAbsolute(cwd) && !CONTROL.test(cwd)
}

/** POSIX single quotes: everything is literal, and a quote in the value closes, escapes and reopens. */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/** The line a person pastes into a terminal, or null when it cannot be made safely. */
export function pasteLine({ argv, cwd } = {}) {
  const command = commandLine(argv)
  if (!command || !folderOk(cwd)) return null
  return `cd ${shellQuote(cwd)} && ${command}`
}

/**
 * What each launcher runs. The folder goes in `--cwd` and the command in `--command`, so the
 * folder is never inside text a shell reads. `--focus true` because the default is to leave the
 * new workspace in the background.
 */
const LAUNCHERS = {
  cmux: {
    label: 'cmux',
    argv: (command, cwd) => ['cmux', 'new-workspace', '--cwd', cwd, '--command', command, '--focus', 'true'],
  },
}

const launcher = (id) => (typeof id === 'string' && Object.hasOwn(LAUNCHERS, id) ? LAUNCHERS[id] : null)

/** The launcher the environment turns on, `{ id, label }`, or null. Exactly the id, nothing looser. */
export function launcherFromEnv(env = process.env) {
  const found = launcher(env.MOON_BASE_TERMINAL)
  return found ? { id: env.MOON_BASE_TERMINAL, label: found.label } : null
}

/** The argument list for a launcher (program first), or null when the launcher, command or folder is not acceptable. */
export function launcherArgv(id, { argv, cwd } = {}) {
  const found = launcher(id)
  const command = commandLine(argv)
  if (!found || !command || !folderOk(cwd)) return null
  return found.argv(command, cwd)
}

/**
 * cmux selects a workspace within its own window (`new-workspace --focus true`), but nothing in its
 * CLI raises the *application* over whatever else is in front — there is no "activate app" command,
 * and `focus-window` only brings forward a window already known to be cmux's. `open -a cmux` is the
 * macOS primitive for that, the same one the OS opener already uses for `claude://`/`codex://`
 * links, so this reuses it rather than adding a new kind of action. macOS only, and only for cmux:
 * there is nothing to run anywhere else.
 */
export function foregroundArgv(id, platform = process.platform) {
  return id === 'cmux' && platform === 'darwin' ? ['open', '-a', 'cmux'] : null
}

/**
 * Best-effort, and forgotten the moment it is sent: the session already opened, or was already
 * open, before this ever runs, so there is nothing useful to tell the page either way. Never
 * rejects and never reports an error, the same as the OS opener's own fire-and-forget launch.
 */
export function runForeground(argv, run = execFile) {
  return new Promise((resolve) => {
    try {
      run(argv[0], argv.slice(1), { timeout: 4000, windowsHide: true }, () => resolve())
    } catch {
      resolve()
    }
  })
}

const TIMEOUT_MS = 8000

/**
 * What the page is told when a launch fails. Fixed words: the tool's own output can hold paths and
 * account details, and none of it is the page's business.
 */
const FAILURES = {
  missing: 'cmux is not on PATH. Start Moon Base from a cmux terminal, or put the cmux command on your PATH.',
  refused: 'cmux refused the request because Moon Base was not started inside a cmux terminal. Start it from one.',
  timeout: 'cmux did not answer in time.',
  other: 'cmux could not open that session.',
}

function failure(err, stdout, stderr) {
  if (err.code === 'ENOENT') return FAILURES.missing
  if (/access denied/i.test(`${stderr}\n${stdout}`)) return FAILURES.refused
  if (err.killed || err.signal === 'SIGTERM') return FAILURES.timeout
  return FAILURES.other
}

/**
 * Whether cmux already has this session open, read from cmux's own on-disk record —
 * `cmux sessions --agent <agent> --session <id> --json`, which cmux's own help says needs no
 * running socket, so this answers even when Moon Base cannot reach cmux's socket to launch
 * anything. It exists to stop a second `claude --resume`/`codex resume` from starting on a
 * session that is already running one: two of those at once are racing writes to the one
 * transcript file both processes think they own.
 *
 * Never rejects, and any surprise — `cmux` missing, a nonzero exit, output that will not parse,
 * a shape this version of cmux has changed — reads as "not open", exactly as if the session had
 * never been seen. This must never be the reason a real, ordinary resume fails.
 */
export function cmuxSessionOpen(agent, id, run = execFile) {
  return new Promise((resolve) => {
    const done = (result) => resolve(result)
    try {
      run('cmux', ['sessions', '--agent', agent, '--session', id, '--json'], { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 }, (err, stdout) => {
        if (err) return done({ open: false })
        try {
          const data = JSON.parse(String(stdout ?? ''))
          const found = Array.isArray(data?.sessions) ? data.sessions.find((s) => s && s.session_id === id) : null
          done({ open: found?.stored_pid_exists === true, workspaceId: typeof found?.workspace_id === 'string' ? found.workspace_id : '' })
        } catch {
          done({ open: false })
        }
      })
    } catch {
      done({ open: false })
    }
  })
}

/**
 * For the doctor: does `cmux sessions` answer, and how many Claude sessions does it know? The count and
 * nothing else — each session it lists carries an id, a folder and more, and none of it leaves this function.
 * `{ answered: true, count }`, or `{ answered: false, why: 'missing' | 'failed' }` (`missing` is no `cmux`
 * on the PATH). Never rejects. Like `cmuxSessionOpen` it runs one fixed argument list with no shell.
 */
export function cmuxSessionsSummary(run = execFile) {
  return new Promise((resolve) => {
    const failed = (why) => resolve({ answered: false, why })
    try {
      run('cmux', ['sessions', '--agent', 'claude', '--json'], { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) return failed(err.code === 'ENOENT' ? 'missing' : 'failed')
        try {
          const data = JSON.parse(String(stdout ?? ''))
          if (!Array.isArray(data?.sessions)) return failed('failed')
          // The list is capped (100 by default); the total is what cmux says it holds.
          const total = Number.isInteger(data.total_matches) && data.total_matches >= 0 ? data.total_matches : data.sessions.length
          resolve({ answered: true, count: total })
        } catch {
          failed('failed')
        }
      })
    } catch {
      failed('failed')
    }
  })
}

/**
 * Run a launcher's argument list once and wait for it, so the page hears whether it worked. Never
 * rejects: a launcher that cannot start is an answer, not a crash. `run` is `execFile`, and is
 * only a parameter so a test can answer for it.
 */
export function runLauncher(argv, run = execFile) {
  return new Promise((resolve) => {
    const [file, ...args] = argv
    try {
      run(file, args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
        resolve(err ? { ok: false, error: failure(err, String(stdout ?? ''), String(stderr ?? '')) } : { ok: true })
      })
    } catch {
      resolve({ ok: false, error: FAILURES.other })
    }
  })
}
