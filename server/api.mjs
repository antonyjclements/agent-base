import { readFileSync } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { schemeHasHandler, schemeOf } from './lib/xdg.mjs'
import { commandLine, cmuxSessionOpen, foregroundArgv, launcherArgv, launcherFromEnv, pasteLine, runForeground, runLauncher } from './lib/terminal.mjs'
import {
  defaultHarness,
  harnessStatus,
  isHarnessId,
  liveSummary,
  newSession as harnessNewSession,
  openThread as harnessOpenThread,
  scanThreads,
  terminalNew as harnessTerminalNew,
  terminalOpen as harnessTerminalOpen,
} from './scan.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.MOON_BASE_DATA || path.join(here, '..', 'data')
const STATE_FILE = path.join(DATA_DIR, 'colony.json')

const STATE_VERSION = 2

/** This copy's version, for `/api/identity`. Empty rather than an error if the file cannot be read. */
const VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '')
  } catch {
    return ''
  }
})()

/**
 * v1 keyed everything on a bare session id, because Claude Code was the only harness and its
 * ids are UUIDs. Adapters now prefix (`claude-code:…`, `codex:…`) so two harnesses can never
 * name the same thread, which means a v1 file's archive list no longer matches anything.
 *
 * Only Claude Code ever wrote a bare id, so the rewrite is unambiguous. One shot, on read.
 */
const BARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const migrateId = (id) => (BARE_UUID.test(id) ? `claude-code:${id}` : id)

function migrate(raw) {
  if (Number(raw.version) >= 2) return raw
  const keys = (o) => Object.fromEntries(Object.entries(asObject(o)).map(([k, v]) => [migrateId(k), v]))
  return {
    ...raw,
    archived: asArray(raw.archived).map(migrateId),
    archivedAt: keys(raw.archivedAt),
    opened: asArray(raw.opened).map(migrateId),
    seen: keys(raw.seen),
    viewedAt: keys(raw.viewedAt),
  }
}

/**
 * Colony state is only ever the things the *game* invents — which plot a project got,
 * what a thread's building looks like, what you archived, which repos you took off the map.
 * The threads themselves stay
 * read-only: this file is the only thing Moon Base writes, anywhere.
 */
const emptyState = () => ({
  version: STATE_VERSION,
  archived: [],
  archivedAt: {},
  opened: [],
  plots: {},
  seen: {},
  hiddenProjects: [],
  viewedAt: {},
  settings: null,
  updatedAt: 0,
})

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const asArray = (v) => (Array.isArray(v) ? v : [])

async function readState() {
  try {
    const raw = migrate(JSON.parse(await fsp.readFile(STATE_FILE, 'utf8')))
    return {
      version: STATE_VERSION,
      archived: asArray(raw.archived),
      archivedAt: asObject(raw.archivedAt),
      opened: asArray(raw.opened),
      plots: asObject(raw.plots),
      seen: asObject(raw.seen),
      hiddenProjects: asArray(raw.hiddenProjects).map(String).filter(Boolean),
      viewedAt: asObject(raw.viewedAt),
      settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : null,
      updatedAt: Number(raw.updatedAt) || 0,
    }
  } catch {
    return emptyState()
  }
}

/**
 * One writer: the browser owns this file and PUTs it whole. Nothing on the server writes it —
 * if anything did, the next save from a page holding older state would silently drop every
 * archive made since that page loaded.
 */
/**
 * Writes are serialised through one chain, and each gets its own temp file.
 *
 * Both halves matter and neither is theoretical. A shared `colony.json.tmp` means two saves
 * landing together race on the rename and one throws ENOENT — a 500 the page has no idea what
 * to do with, so the save is simply lost. And read-then-write is not atomic across an `await`,
 * so without the chain two callers can both pass the version check below before either writes.
 */
let writeQueue = Promise.resolve()
let tmpSeq = 0
const serialise = (fn) => (writeQueue = writeQueue.then(fn, fn))

async function writeState(next) {
  const state = {
    version: STATE_VERSION,
    archived: asArray(next.archived),
    archivedAt: asObject(next.archivedAt),
    opened: asArray(next.opened),
    plots: asObject(next.plots),
    seen: asObject(next.seen),
    hiddenProjects: asArray(next.hiddenProjects).map(String).filter(Boolean),
    viewedAt: asObject(next.viewedAt),
    settings: next.settings && typeof next.settings === 'object' ? next.settings : null,
    updatedAt: Date.now(),
  }
  await fsp.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${STATE_FILE}.${process.pid}.${++tmpSeq}.tmp`
  try {
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2))
    await fsp.rename(tmp, STATE_FILE)
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return state
}

/**
/**
 * Hand a `harness://…` deep link, or a folder, to whatever opens things on this OS. The
 * opener gets an argument list, never a shell string.
 *
 * Only `present()` calls this, and no harness knowledge ever reaches it: an adapter says what it
 * wants opened and this decides how, which is the seam that keeps `server/harnesses/` swappable.
 *
 * macOS's `open(1)` does both jobs, and `xdg-open` is the Linux equivalent. On Windows the
 * equivalent is ShellExecute, reached through `rundll32 url.dll,FileProtocolHandler`: a
 * registered protocol URL goes to its app and a folder opens in Explorer, with the argument
 * passed through untouched. Two more obvious routes were tried and rejected — `explorer.exe
 * <url>` silently drops any URL that carries a query string, so `code/new?folder=…` never
 * arrived, and `cmd /c start` parses its own argument line, where the `%3A%5C` escapes in that
 * same link are exactly what it expands.
 *
 * The spawn is guarded because the opener may simply not be installed — a headless Linux box
 * has no `xdg-open` — and an unhandled `error` event on a child process takes the whole server
 * down. Failing quietly is right here: there is nothing the page could do with the error, and
 * the scan path must never depend on whether presentation worked.
 */
const OPENERS = {
  darwin: ['open'],
  win32: ['rundll32', 'url.dll,FileProtocolHandler'],
  linux: ['xdg-open'],
}

/** The opener's argument list, or null where there is none. The target is always one last argument. */
export function openerCommand(target, platform = process.platform) {
  const opener = OPENERS[platform]
  return opener ? [...opener, target] : null
}

function launch(target) {
  const argv = openerCommand(target)
  if (!argv) return
  const [cmd, ...args] = argv
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}

/**
 * The one place that starts anything. Tests swap it for a recorder so that no test ever opens a
 * real app, and nothing reachable over HTTP can change it.
 */
let openTarget = launch
export const setOpener = (fn) => {
  openTarget = fn
}

/**
 * A folder is openable only if it is still on this machine and still a directory. Paths
 * arrive from the page, which got them from a scan that may be minutes old — a repo that
 * has since been moved or deleted must fail here rather than hand the opener a dead path.
 * Absolute is judged by `path.isAbsolute` rather than a leading `/`, which no Windows path has.
 */
async function resolveFolder(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return null
  const dir = path.resolve(folder)
  const stat = await fsp.stat(dir).catch(() => null)
  return stat && stat.isDirectory() ? dir : null
}

/**
 * The terminal launcher's counterpart to `openTarget`: the second and last place that starts
 * anything, and only when `MOON_BASE_TERMINAL` names a launcher. It is given a finished argument
 * list and answers `{ ok }` or `{ ok: false, error }`. Tests swap it for a recorder, and nothing
 * reachable over HTTP can change it.
 */
let runTerminal = runLauncher
export const setTerminalRunner = (fn) => {
  runTerminal = fn
}

/**
 * Whether cmux already has a given session open (`cmuxSessionOpen`), swappable the same way, so a
 * test never shells out to the real `cmux` to find out.
 */
let probeSessionOpen = cmuxSessionOpen
export const setSessionProbe = (fn) => {
  probeSessionOpen = fn
}

/**
 * Bringing cmux itself forward (`runForeground`), swapped the same way so no test raises a real
 * application. Its result is never read by the caller either — see `runForeground`.
 */
let foregroundTerminal = runForeground
export const setForegrounder = (fn) => {
  foregroundTerminal = fn
}

/** Best-effort, after cmux has (or already had) the session: never lets a foreground problem change the answer already decided. */
async function tryForeground(launcherId) {
  const argv = foregroundArgv(launcherId)
  if (!argv) return
  await Promise.resolve()
    .then(() => foregroundTerminal(argv))
    .catch(() => {})
}

/**
 * A folder for a new session, and the tool to start in it. The folder must already be the home of
 * a thread the scan found, and still be there; the tool must be a registered one. Both the URL
 * route and the terminal routes ask this, so neither can be looser than the other.
 */
async function newSessionTarget(body) {
  const dir = typeof body.folder === 'string' && path.isAbsolute(body.folder) ? path.resolve(body.folder) : ''
  const known = new Set((await scanThreads()).map((t) => t.projectPath).filter(Boolean).map((p) => path.resolve(p)))
  if (!dir || !known.has(dir)) return { ok: false, error: 'That folder is not one of your repos' }
  if (!(await resolveFolder(dir))) return { ok: false, error: 'That folder is not on this machine any more' }
  const harness = body.harness === undefined ? await defaultHarness() : body.harness
  if (!isHarnessId(harness)) return { ok: false, error: 'That tool is not supported' }
  return { ok: true, dir, harness }
}

/**
 * What to run in a terminal, and where, for a thread (`{ id }`) or a new session (`{ folder,
 * harness }`). A thread is named by id and looked up in the server's own scan, exactly as for
 * `/api/open`, so the adapter's `ref` never comes from the request; and the command is whatever
 * the adapter describes, checked here token by token. Nothing else in the body is read.
 *
 * Returns `{ ok: true, argv, cwd, harness, resumeId }` or `{ ok: false, status, error }`.
 * `resumeId` is the exact session id being resumed, when there is one — an adapter names it
 * separately from `argv` so the launch route can ask cmux whether that session is already open
 * without parsing a command line back apart. It is `''` for a new session, which has none yet.
 */
async function terminalTarget(body) {
  const refuse = (status, error) => ({ ok: false, status, error })
  if (process.platform === 'win32') return refuse(400, 'Terminal commands work on macOS and Linux only')

  let answer
  let harness
  if (body.id !== undefined) {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id || id.length > 300) return refuse(400, 'Say which thread to open')
    const thread = (await scanThreads()).find((t) => t.id === id)
    if (!thread) return refuse(404, 'That thread is not on this machine any more')
    harness = thread.harness
    answer = await harnessTerminalOpen(thread.harness, thread.ref)
  } else {
    const target = await newSessionTarget(body)
    if (!target.ok) return refuse(400, target.error)
    harness = target.harness
    answer = await harnessTerminalNew(target.harness, target.dir)
  }

  if (!answer || !answer.ok) return refuse(400, typeof answer?.error === 'string' ? answer.error : 'Nothing to open')
  if (!commandLine(answer.argv)) return refuse(400, 'That is not a command Moon Base hands to a terminal')
  const cwd = await resolveFolder(answer.cwd)
  if (!cwd) return refuse(400, 'That thread’s folder is not on this machine any more')
  if (!pasteLine({ argv: answer.argv, cwd })) {
    return refuse(400, 'That folder’s name has characters a terminal command cannot carry safely')
  }
  return { ok: true, argv: answer.argv, cwd, harness, resumeId: typeof answer.resumeId === 'string' ? answer.resumeId : '' }
}

/** The cmux `sessions --agent` name for one of our harness ids, or '' where there is no mapping. */
const CMUX_AGENT = { 'claude-code': 'claude', codex: 'codex' }

/**
 * Only these two schemes are ever handed to the OS opener. The adapters build their URLs from
 * pattern-checked ids and encoded folders, and this is the second lock on the same door: a URL that
 * is not plainly `claude://` or `codex://` followed by printable characters never reaches `open`.
 */
const OPENABLE_SCHEMES = new Set(['claude:', 'codex:'])

function openableUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return false
  if (!/^[\x21-\x7e]+$/.test(url)) return false // printable ASCII: no spaces, no control characters
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return OPENABLE_SCHEMES.has(parsed.protocol) && url.length > parsed.protocol.length + 2 && url.startsWith(`${parsed.protocol}//`)
}

/**
 * Show a harness's answer to "open this" — `{ ok, url }` — and say truthfully whether anything
 * happened.
 *
 * macOS and Windows hand the URL to the opener: a scheme the harness's app registers is always
 * answered there, so nothing is probed. Linux is the platform where the URL may have nowhere to
 * go — the desktop app is optional and often absent, and `xdg-open` on a scheme nobody claims
 * exits quietly, which used to reach the page as "Opened". So there the scheme is checked first
 * and the page is told when nothing answers it.
 *
 * The only thing this ever starts is the OS opener, with the URL as a plain argument.
 */
export async function present(result) {
  // Only the reason reaches the page.
  if (!result || !result.ok) return { ok: false, error: result?.error || 'Nothing to open' }
  if (!result.url) return { ok: false, error: 'That harness has no deep link to open' }
  if (!openableUrl(result.url)) return { ok: false, error: 'That is not a link Moon Base opens' }

  if (process.platform === 'linux' && !(await schemeHasHandler(result.url))) {
    const scheme = schemeOf(result.url)
    return {
      ok: false,
      error: scheme ? `Nothing on this machine opens ${scheme}:// links` : 'Nothing on this machine can open that',
    }
  }
  openTarget(result.url)
  return { ok: true, url: result.url }
}

/**
 * Mark the threads the colony has retired.
 *
 * Nothing is written anywhere. Moon Base used to set `isArchived` on the desktop app's own
 * session record, and it did land on disk — but the app serves from the copy it loaded at
 * launch, so the thread stayed put in its own list until the next restart, and the app would
 * rewrite the record from memory whenever it touched the thread. Papering over that took a
 * re-assert on every poll, a `ps` sweep to guess whether the app had re-read the file, and a
 * *pending* state for the gap between the two — a lot of machinery for something that still
 * looked broken to anyone with the app open.
 *
 * So the colony keeps its own list and that is all it does. Archiving in the harness's own UI
 * still sends the astronaut home, because the scan reads that flag; archiving here is the
 * colony's own business. Nothing outside `data/colony.json` is ever written.
 */
async function reconcileArchived(threads) {
  const state = await readState()
  if (!state.archived.length) return threads
  const wanted = new Set(state.archived)

  /**
   * An archive is remembered by the thread id the page saw, but that id is only the *canonical*
   * one. A thread the desktop app knows and the CLI has not written a transcript for is keyed on
   * its desktop record; the moment a transcript appears it re-keys to that session's UUID, and a
   * list keyed on the old string stops matching. The thread quietly comes back, which reads as
   * the archive having failed.
   *
   * So the ids inside `ref` count too. They are opaque to everything else here — this only ever
   * asks whether a string it already holds appears among them.
   */
  const archived = (thread) => {
    if (wanted.has(thread.id)) return true
    const ref = thread.ref
    if (!ref || typeof ref !== 'object') return false
    for (const value of Object.values(ref)) {
      if (typeof value === 'string') {
        if (value && wanted.has(value)) return true
      } else if (Array.isArray(value)) {
        for (const v of value) if (typeof v === 'string' && v && wanted.has(v)) return true
      }
    }
    return false
  }

  return threads.map((t) => (archived(t) ? { ...t, archived: true } : t))
}

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

// The machine's own LAN addresses count as local too, so the colony can be
// served to the home network with MOON_BASE_HOST set. Harmless when bound
// to loopback (those hosts can't reach the server anyway), and the Host +
// Origin pairing still stops DNS rebinding and CSRF exactly as before.
for (const addrs of Object.values(os.networkInterfaces())) {
  for (const a of addrs || []) {
    if (a && a.family === 'IPv4' && !a.internal && a.address) LOCAL_HOSTS.add(a.address)
  }
}

/** Hostname out of a `Host:` or `Origin:` value, with the port and any brackets stripped. */
function hostnameOf(value) {
  if (!value) return ''
  const raw = String(value).includes('://') ? value : `http://${value}`
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return ''
  }
}

/**
 * Only a page this server itself served may drive it. Two checks, against two different
 * attacks, both of which a localhost server with an `open`-the-desktop-app button is a
 * genuinely attractive target for:
 *
 *   - **Host** stops DNS rebinding. Binding to 127.0.0.1 is not on its own enough: an
 *     attacker who points `evil.com` at 127.0.0.1 reaches us *as a same-origin page*, and
 *     can then read every response. The rebound request still carries `Host: evil.com`.
 *   - **Origin** stops CSRF. A cross-site `fetch` with a `text/plain` body is not
 *     preflighted, so without this check any page you happened to be visiting could POST
 *     here — spawning sessions, opening Finder windows, or wiping the colony layout —
 *     even though it could never read the reply.
 *
 * A state-changing request with no `Origin` at all is refused: browsers always send one on
 * POST/PUT, so its absence means the caller is not the page. That does mean a bare `curl`
 * POST is rejected; pass `-H 'Origin: http://localhost:5274'` if you are scripting this.
 */
function isLocalRequest(req) {
  if (!LOCAL_HOSTS.has(hostnameOf(req.headers.host))) return false

  const origin = req.headers.origin
  if (origin && origin !== 'null') return LOCAL_HOSTS.has(hostnameOf(origin))
  return req.method === 'GET' || req.method === 'HEAD'
}

function readJsonBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(Object.assign(new Error('That request body is not valid JSON'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

/** Connect-style middleware: handles /api/*, passes everything else through. */
export async function apiMiddleware(req, res, next) {
  let url
  try {
    url = new URL(req.url, 'http://localhost')
  } catch {
    return send(res, 400, { error: 'That is not a valid address' }) // not an exception: this is async, so a throw would be an unhandled rejection
  }
  if (!url.pathname.startsWith('/api/')) return next ? next() : send(res, 404, { error: 'Not found' })

  if (!isLocalRequest(req)) {
    return send(res, 403, { error: 'Moon Base only answers its own page on this machine' })
  }

  try {
    if (url.pathname === '/api/threads' && req.method === 'GET') {
      const threads = await reconcileArchived(await scanThreads())
      // A harness that is present but cannot read its own store says so here, rather than
      // appearing healthy in the list while quietly contributing nothing.
      const warnings = (await harnessStatus()).filter((h) => h.detected && h.error).map((h) => h.error)
      return send(res, 200, { threads, scannedAt: Date.now(), warnings, live: liveSummary() })
    }

    /**
     * Who is on this port. `moonbase1` asks it of every port in its range to find a copy that is already
     * running, so it says what it is and whether its terminal launcher is on, and nothing about the
     * machine: no path, no environment.
     */
    if (url.pathname === '/api/identity' && req.method === 'GET') {
      return send(res, 200, { app: 'moon-base', version: VERSION, pid: process.pid, launcher: launcherFromEnv() })
    }

    if (url.pathname === '/api/harnesses' && req.method === 'GET') {
      return send(res, 200, { harnesses: await harnessStatus() })
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      return send(res, 200, await readState())
    }

    /**
     * Optimistic concurrency, so a second tab cannot paste over the first one's work.
     *
     * `baseUpdatedAt` is the version the caller last agreed with. If the file no longer carries
     * it, the caller's whole-file body describes a colony that no longer exists — so the disk
     * state comes back with a 409 and the page merges against it. Merging here was the other
     * option and it is the wrong place: the server has no idea which of two `plots` layouts a
     * person actually dragged.
     *
     * The test is inequality rather than "older than", because a colony file also moves
     * *backwards* — restored from a backup, edited by hand — and a page open across that holds
     * a base newer than disk, which sails through a greater-than check and pastes the
     * pre-restore colony straight back.
     *
     * A missing or zero base is a first write and is allowed: nothing to lose on a fresh
     * install, and it keeps the endpoint drivable from `curl`.
     */
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const body = await readJsonBody(req)
      const base = Number(body.baseUpdatedAt) || 0
      return serialise(async () => {
        const current = await readState()
        if (base && current.updatedAt !== base) return send(res, 409, current)
        return send(res, 200, await writeState(body))
      })
    }

    /**
     * The two things the page can ask for, and neither takes anything it could use to run
     * something. A thread is named by id and looked up in the server's own scan, so the adapter's
     * `ref` never comes from the request; a folder must already be the home of a thread the scan
     * found. Extra fields in the body — a ref, a URL, a command — are simply never read.
     */
    if (url.pathname === '/api/open' && req.method === 'POST') {
      const body = asObject(await readJsonBody(req))
      const id = typeof body.id === 'string' ? body.id : ''
      if (!id || id.length > 300) return send(res, 400, { ok: false, error: 'Say which thread to open' })
      const thread = (await scanThreads()).find((t) => t.id === id)
      if (!thread) return send(res, 404, { ok: false, error: 'That thread is not on this machine any more' })
      if (thread.canOpen === false) {
        return send(res, 400, { ok: false, error: thread.openHint || 'That thread cannot be opened' })
      }
      const shown = await present(await harnessOpenThread(thread.harness, thread.ref))
      return send(res, shown.ok ? 200 : 400, shown)
    }

    if (url.pathname === '/api/new-session' && req.method === 'POST') {
      const target = await newSessionTarget(asObject(await readJsonBody(req)))
      if (!target.ok) return send(res, 400, target)
      const shown = await present(await harnessNewSession(target.harness, target.dir))
      return send(res, shown.ok ? 200 : 400, shown)
    }

    /**
     * The terminal hand-off (AC13). Three fixed routes, and the same rule as above: a thread by id
     * or a folder the scan knows, and nothing else from the request.
     *
     * `terminal-launcher` tells the page whether the environment has turned a launcher on.
     * `terminal-command` returns the line to paste, and starts nothing. `terminal-launch` runs the
     * launcher once, only when it is on, and reports in fixed words whether it worked.
     */
    if (url.pathname === '/api/terminal-launcher' && req.method === 'GET') {
      return send(res, 200, { launcher: launcherFromEnv() })
    }

    if (url.pathname === '/api/terminal-command' && req.method === 'POST') {
      const target = await terminalTarget(asObject(await readJsonBody(req)))
      if (!target.ok) return send(res, target.status, { ok: false, error: target.error })
      return send(res, 200, { ok: true, command: pasteLine(target) })
    }

    if (url.pathname === '/api/terminal-launch' && req.method === 'POST') {
      const body = asObject(await readJsonBody(req))
      const launcher = launcherFromEnv()
      if (!launcher) {
        return send(res, 400, {
          ok: false,
          error: 'The terminal launcher is not enabled. Start Moon Base with MOON_BASE_TERMINAL=cmux, from a cmux terminal.',
        })
      }
      const target = await terminalTarget(body)
      if (!target.ok) return send(res, target.status, { ok: false, error: target.error })

      /**
       * A session cmux already has open is not opened a second time: two `--resume`/`resume`
       * processes racing the one transcript file is worse than a click that does nothing. The
       * probe reads cmux's own record and never touches the socket, so this works even when the
       * launch below would not (Moon Base started outside cmux). A probe that throws, times out
       * or answers with anything but `{ open: true }` is read as "not open" here too — the same
       * rule the probe itself follows — so it can never be the reason an ordinary resume fails.
       */
      if (launcher.id === 'cmux' && target.resumeId && CMUX_AGENT[target.harness]) {
        const probe = await Promise.resolve()
          .then(() => probeSessionOpen(CMUX_AGENT[target.harness], target.resumeId))
          .catch(() => null)
        if (probe && probe.open === true) {
          await tryForeground(launcher.id)
          return send(res, 200, { ok: true, already: true })
        }
      }

      const argv = launcherArgv(launcher.id, target)
      if (!argv) return send(res, 400, { ok: false, error: 'Moon Base cannot hand that to the terminal' })
      const result = await Promise.resolve()
        .then(() => runTerminal(argv))
        .catch(() => null)
      if (result && result.ok === true) {
        await tryForeground(launcher.id)
        return send(res, 200, { ok: true })
      }
      // Only a plain string is passed on, and the real launcher only ever produces fixed ones.
      const error = typeof result?.error === 'string' ? result.error : `${launcher.label} could not open that session.`
      return send(res, 400, { ok: false, error })
    }

    return send(res, 404, { error: 'Unknown endpoint' })
  } catch (err) {
    return send(res, err?.status || 500, { error: String(err && err.message ? err.message : err) })
  }
}
