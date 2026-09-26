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
