/**
 * The command line for the hook installer.
 *
 *     node bin/moon-base.mjs install-hooks [--tool claude|codex|all] [--dry-run]
 *     node bin/moon-base.mjs uninstall-hooks [--tool ...] [--dry-run]
 *     node bin/moon-base.mjs hooks-status
 *
 * Every change is shown as an exact diff and needs a typed yes, tool by tool. There is deliberately no
 * flag that skips the question, and a pipe cannot answer it: without a terminal it refuses.
 */
import os from 'node:os'
import readline from 'node:readline'

import {
  LABEL,
  TOOLS,
  applyPlan,
  installSupportFiles,
  installedTools,
  planInstall,
  planUninstall,
  removeSupportFiles,
  status,
} from './install.mjs'

const USAGE = `Usage: node bin/moon-base.mjs <command> [options]

Commands:
  install-hooks     Add Moon Base's live-status hooks to Claude Code and/or Codex
  uninstall-hooks   Remove exactly what install-hooks added
  hooks-status      Show what is installed and whether events are arriving

Options:
  --tool <claude|codex|all>   Which tool to change (default: all)
  --dry-run                   Show the change and write nothing
  -h, --help                  Show this help

Every change is shown as an exact diff and asked about, tool by tool. There is no option to skip
the question, and it needs an interactive terminal.`

function parse(argv) {
  const [command, ...rest] = argv
  const opts = { tool: 'all', dryRun: false, help: false }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--tool') opts.tool = rest[++i]
    else if (a.startsWith('--tool=')) opts.tool = a.slice('--tool='.length)
    else if (a === '-h' || a === '--help') opts.help = true
    else return { error: `Unknown option: ${a}` }
  }
  if (!['all', ...TOOLS].includes(opts.tool)) return { error: '--tool must be claude, codex or all' }
  return { command, opts }
}

/** A yes/no question on the terminal, or null when there is no terminal to ask on. */
function terminalAsker(io) {
  if (io.confirm) return { ask: io.confirm, close() {} }
  if (!io.isTTY) return null
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return {
    ask: (question) => new Promise((resolve) => rl.question(question, (a) => resolve(/^y(es)?$/i.test(a.trim())))),
    close: () => rl.close(),
  }
}

export async function run(argv, io = {}) {
  const env = io.env ?? process.env
  const home = io.home ?? os.homedir()
  const out = io.out ?? ((t) => console.log(t))
  const err = io.err ?? ((t) => console.error(t))
  const isTTY = io.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const ctx = { env, home }

  const parsed = parse(argv)
  if (parsed.error) {
    err(`${parsed.error}\n\n${USAGE}`)
    return 2
  }
  const { command, opts } = parsed
  if (opts.help || command === '--help' || command === '-h' || command === 'help') {
    out(USAGE)
    return 0
  }
  if (!['install-hooks', 'uninstall-hooks', 'hooks-status'].includes(command)) {
    err(`${command ? `Unknown command: ${command}` : 'No command given.'}\n\n${USAGE}`)
    return 2
  }

  if (command === 'hooks-status') return showStatus(ctx, out)

  const installing = command === 'install-hooks'
  const tools = opts.tool === 'all' ? TOOLS : [opts.tool]

  const plans = []
  let failed = false
  for (const tool of tools) {
    const p = await (installing ? planInstall : planUninstall)(tool, ctx)
    out(`\n${LABEL[tool]}: ${p.file}`)
    if (p.error) {
      err(`  Cannot change this file: ${p.error}`)
      failed = true
      continue
    }
    if (!p.changed) {
      out(`  ${p.notes.join(' ')}`)
      continue
    }
    out(p.diff)
    for (const note of p.notes) out(`  Note: ${note}`)
    plans.push(p)
  }

  if (opts.dryRun) {
    out('\nDry run: nothing was written.')
    return failed ? 1 : 0
  }
  if (!plans.length) return failed ? 1 : 0

  const asker = terminalAsker({ confirm: io.confirm, isTTY })
  if (!asker) {
    err('\nThis command asks for confirmation, so it needs an interactive terminal. Nothing was changed. Use --dry-run to see the change without one.')
    return 1
  }

  let applied = 0
  let skipped = 0
  let codexApplied = false
  try {
    for (const p of plans) {
      const verb = installing ? 'Add Moon Base’s hooks to' : 'Remove Moon Base’s hooks from'
      const yes = await asker.ask(`\n${verb} ${LABEL[p.tool]} (${p.file})? [y/N] `)
      if (!yes) {
        out(`  Skipped ${LABEL[p.tool]}.`)
        skipped++
        continue
      }
      try {
        if (installing) await installSupportFiles(ctx)
        await applyPlan(p, ctx)
        out(`  Done: ${LABEL[p.tool]}.`)
        applied++
        if (installing && p.tool === 'codex') codexApplied = true
      } catch (e) {
        err(`  ${e.message}`)
        failed = true
      }
    }
  } finally {
    asker.close()
  }

  if (!installing && applied && !(await installedTools(ctx)).length) {
    await removeSupportFiles(ctx)
    out('\nRemoved the hook script from the Moon Base folder. Recorded events were kept.')
  }
  if (!applied) out('\nNo changes made.')
  if (codexApplied) {
    out('\nCodex skips hooks it has not trusted. Start Codex, run /hooks, and trust the Moon Base entries. Until then Codex status is inferred from its files.')
  }
  if (installing && applied) out('\nNew sessions will report live. A session that is already open may need a restart to pick the hooks up.')
  return failed || (!applied && skipped) ? 1 : 0
}

async function showStatus(ctx, out) {
  const s = await status(ctx)
  for (const tool of TOOLS) {
    const t = s[tool]
    const state = t.installed ? 'installed' : t.partly ? 'partly installed' : 'not installed'
    out(`${LABEL[tool]}: ${state} (${t.file})`)
    if (t.lastEventAt) out(`  Last event: ${new Date(t.lastEventAt).toLocaleString()}`)
    if (t.advice) out(`  ${t.advice}`)
  }
  return 0
}
