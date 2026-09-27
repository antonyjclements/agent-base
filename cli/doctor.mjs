/**
 * `moonbase1 doctor`: what start would decide, and why each live source is or is not reporting. It reads
 * and reports and nothing else: it starts nothing, writes nothing, and always exits 0, because "cmux is
 * off" is an answer, not a failure.
 *
 * It says kinds, counts and ages. It never prints what a session said (a cmux row's content), an
 * environment value, a path or an id: the person running it may paste the output into a chat to ask why
 * a bot is missing, and that has to be safe.
 */
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { cmuxFile, cmuxStatusEnabled } from '../server/hooks/cmux.mjs'
import { eventsFile } from '../server/hooks/events.mjs'
import { LiveStatus } from '../server/hooks/live.mjs'
import { buildState } from './build.mjs'
import { insideCmux } from './cmux-env.mjs'
import { DEFAULT_PORT, PORT_SPAN, pickPort, probePort, urlHost } from './port.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const n = (v, unit) => `${v} ${unit}${v === 1 ? '' : 's'}`
  if (s < 60) return n(s, 'second')
  if (s < 3600) return n(Math.round(s / 60), 'minute')
  return n(Math.round(s / 3600), 'hour')
}

/** One live source, in a sentence: reporting, quiet, or why it cannot be read. */
function describe(source, { what, missing }, now) {
  switch (source.problem) {
    case 'missing':
      return missing
    case 'not-private':
      return 'refused: someone other than you could write to it, so it is not trusted'
    case 'not-a-file':
    case 'unreadable':
      return 'not readable'
    default: {
      const age = source.lastAt ? ago(now - source.lastAt) : ''
      if (source.reporting) return `reporting (last ${what} ${age} ago)`
      return `present, nothing in the last 10 minutes${age ? ` (last ${what} ${age} ago)` : ''}`
    }
  }
}

async function defaultMarkers() {
  return (await import('../server/harnesses/claude-code.mjs')).liveSessionMarkers()
}

export async function doctor(_argv, io = {}) {
  const env = io.env ?? process.env
  const home = io.home ?? os.homedir()
  const out = io.out ?? ((l) => console.log(l))
  const now = io.now ?? Date.now
  const root = io.root ?? ROOT
  const probe = io.probe ?? probePort
  const build = io.build ?? { state: buildState }
  const markers = io.markers ?? defaultMarkers
  const makeLive = io.makeLive ?? ((options) => new LiveStatus(options))
  const row = (label, text) => out(`  ${`${label}:`.padEnd(20)}${text}`)

  out('Moon Base doctor')

  out('\nStart')
  const inside = insideCmux(env)
  row('Inside cmux', inside ? 'yes' : 'no')
  row(
    'Terminal launcher',
    env.MOON_BASE_TERMINAL !== undefined
      ? 'set by MOON_BASE_TERMINAL, and left as you set it'
      : inside
        ? 'would be turned on for you (inside cmux)'
        : 'off (not inside cmux); copy mode still works'
  )
  const base = Number(env.PORT) || DEFAULT_PORT
  // Ask where start asks. The address itself is not printed: it comes from the environment.
  const shownHost = urlHost(env.MOON_BASE_HOST || '127.0.0.1')
  const pick = await pickPort({ base, probe: (port) => probe(port, { host: shownHost }) })
  row(
    'Port',
    pick.kind === 'reuse'
      ? `a Moon Base is already running on port ${pick.port} (moonbase1 would use it)`
      : pick.kind === 'free'
        ? `${pick.port} is free, so moonbase1 would start there`
        : `no free port from ${base} to ${base + PORT_SPAN}`
  )
  const built = await build.state({ root })
  row(
    'Build',
    built.state === 'fresh'
      ? 'fresh'
      : built.state === 'stale'
        ? 'stale (the source changed; moonbase1 will rebuild it)'
        : 'missing (moonbase1 will build it on first run)'
  )

  out('\nLive status')
  const cmuxOn = cmuxStatusEnabled(env)
  const live = makeLive({ file: eventsFile(env, home), cmuxFile: cmuxOn ? cmuxFile(env, home) : undefined, now })
  await live.refresh().catch(() => {})
  const sources = Object.fromEntries(live.diagnose().map((s) => [s.id, s]))
  const t = now()
  row('Hooks', describe(sources.hooks, { what: 'event', missing: 'no events file yet (Moon Base’s hooks are not installed, or have not fired)' }, t))
  row(
    'cmux stream',
    cmuxOn
      ? describe(sources.cmux, { what: 'row', missing: 'not found (is cmux installed? it keeps its stream in ~/.cmuxterm)' }, t)
      : 'switched off (MOON_BASE_CMUX_STATUS)'
  )
  const found = [...(await markers()).values()]
  const count = (status) => found.filter((m) => m.status === status).length
  row(
    'Claude markers',
    found.length
      ? `${found.length} live session${found.length === 1 ? '' : 's'} (${count('busy')} busy, ${count('idle')} idle)`
      : 'no live sessions'
  )
  return 0
}
