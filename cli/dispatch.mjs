/**
 * The one command. No arguments (or `start`, or an option) starts Moon Base; `doctor` runs the doctor; the
 * hook commands go to the installer exactly as they did when this was `npm run moon-base -- <command>`.
 * Nothing under `server/` or `src/` imports this, and a test scans for that: the command line reaches the
 * server, never the other way round.
 */
import { run as runHooks } from '../hooks/cli.mjs'
import { start } from './start.mjs'
import { USAGE } from './usage.mjs'

const HOOK_COMMANDS = new Set(['install-hooks', 'uninstall-hooks', 'hooks-status'])
const HELP = new Set(['--help', '-h', 'help'])

export async function dispatch(argv, io = {}) {
  const out = io.out ?? ((l) => console.log(l))
  const err = io.err ?? ((l) => console.error(l))
  const [command, ...rest] = argv
  const startCommand = io.start ?? start

  if (command === undefined) return startCommand([], io)
  if (command === 'start') return startCommand(rest, io)
  if (HELP.has(command)) {
    out(USAGE)
    return 0
  }
  if (command.startsWith('-')) return startCommand(argv, io)
  if (command === 'doctor') return (io.doctor ?? (await import('./doctor.mjs')).doctor)(rest, io)
  if (HOOK_COMMANDS.has(command)) return (io.hooks ?? runHooks)(argv, io)

  err(`Unknown command: ${command}\n\n${USAGE}`)
  return 2
}
