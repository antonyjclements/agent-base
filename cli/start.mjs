/**
 * `moonbase1` with no arguments: make sure there is a build, find a port (or the copy that is already
 * running), start the server, and open the page. Every dependency is injectable, so the decisions can be
 * tested without starting anything.
 *
 * The server runs inside this process, so it is a descendant of the terminal it was started from, which is
 * what cmux's socket needs before it will answer the terminal launcher. The launcher is switched on the
 * way it always was, through `MOON_BASE_TERMINAL` in the server's environment; this only sets it when the
 * person has not, and never overrides one they did.
 */
import { fileURLToPath } from 'node:url'
import { insideCmux } from './cmux-env.mjs'
import { buildState, runBuild } from './build.mjs'
import { openPage } from './open-page.mjs'
import { DEFAULT_PORT, PORT_SPAN, pickPort, probePort, urlHost } from './port.mjs'
import { USAGE } from './usage.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LOOPBACK = ['127.0.0.1', 'localhost', '::1']

function parse(argv) {
  const opts = { noOpen: false, help: false, port: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-open') opts.noOpen = true
    else if (a === '-h' || a === '--help') opts.help = true
    else if (a === '--port' || a.startsWith('--port=')) {
      const value = a === '--port' ? argv[++i] : a.slice('--port='.length)
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1024 || Number(value) > 65535) {
        return { error: '--port needs a whole number from 1024 to 65535.' }
      }
      opts.port = Number(value)
    } else return { error: `Unknown option: ${a}` }
  }
  return opts
}

export async function start(argv, io = {}) {
  const env = io.env ?? process.env
  const out = io.out ?? ((l) => console.log(l))
  const err = io.err ?? ((l) => console.error(l))
  const root = io.root ?? ROOT
  const build = io.build ?? { state: buildState, run: runBuild }
  const probe = io.probe ?? probePort
  const open = io.open ?? openPage
  // Imported when it is needed: it reads its data folder from the environment as it loads.
  const serve = io.serve ?? (async (options) => (await import('../server/serve.mjs')).serve(options))

  const opts = parse(argv)
  if (opts.error) {
    err(`${opts.error}\n\n${USAGE}`)
    return 2
  }
  if (opts.help) {
    out(USAGE)
    return 0
  }

  const built = await build.state({ root })
  if (built.state !== 'fresh') {
    out(built.state === 'missing' ? 'Building Moon Base (first run)…' : 'Building Moon Base (the source changed)…')
    if ((await build.run({ root, err })) !== 0) {
      err('The build failed, so nothing was started. Fix what it reported above, then run moonbase1 again.')
      return 1
    }
  }

  const host = env.MOON_BASE_HOST || '127.0.0.1'
  // Where the server is, for the page and for the search below: a copy on `::1` is not found by asking `127.0.0.1`.
  const shownHost = urlHost(host)
  const urlFor = (port) => `http://${shownHost}:${port}`
  const inside = insideCmux(env)

  const base = opts.port ?? (Number(env.PORT) || DEFAULT_PORT)
  const pick = await pickPort({ base, probe: (port) => probe(port, { host: shownHost }) })
  if (pick.kind === 'none') {
    err(`No free port from ${base} to ${base + PORT_SPAN}. Free one, or start the search somewhere else with --port.`)
    return 1
  }

  if (pick.kind === 'reuse') {
    const url = urlFor(pick.port)
    out(`Moon Base is already running at ${url}, so that copy is used.`)
    if (inside && !pick.identity?.launcher) {
      out('That copy has the terminal launcher off. To turn it on here, stop it and run moonbase1 again.')
    }
    if (!opts.noOpen && !open(url)) out(`Open ${url} in your browser.`)
    return 0
  }

  if (env.MOON_BASE_TERMINAL !== undefined) {
    out('MOON_BASE_TERMINAL is set, so the terminal launcher is left as you set it.')
  } else if (inside) {
    env.MOON_BASE_TERMINAL = 'cmux'
    out('Inside cmux: the terminal launcher is on.')
  } else {
    out('Not inside cmux: the terminal launcher is off. Copy mode still works.')
  }
  if (!LOOPBACK.includes(host)) {
    out('MOON_BASE_HOST is not a loopback address, so anyone on that network can see your thread titles and paths and open threads, with no login.')
  }

  let handle
  try {
    handle = await serve({ port: pick.port, host })
  } catch (e) {
    // The error's code, not its message: a message can carry the address it was told to use, and nothing here prints that back.
    err(e?.code === 'EADDRINUSE' ? `Port ${pick.port} was taken just now. Run moonbase1 again.` : `Could not start (${e?.code || 'unexpected error'}).`)
    return 1
  }

  const url = urlFor(handle.port)
  out(`Moon Base → ${url}`)
  out('Press Ctrl-C to stop.')
  if (!opts.noOpen && !open(url)) out(`Open ${url} in your browser.`)
  return 0
}
