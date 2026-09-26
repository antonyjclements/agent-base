/**
 * Live status: what the hooks, cmux's own event stream and Claude Code's own busy/idle marker say
 * each session is doing right now, laid over what the adapters read from the files.
 *
 * A signal is a hint, never a source of bots. It colours a thread the scan already found and does
 * nothing else; one for a session nobody has scanned is held for a minute in case the scan is a step
 * behind, then forgotten. Every state has a limit, so a source that stops reporting hands its
 * threads straight back to what their files say, with no error and nothing to do. Where sources
 * disagree, the newest signal for a session wins, whichever source it came from.
 */
import { EventTail, eventsFile } from './events.mjs'
import { cmuxFile as defaultCmuxFile, cmuxStatusEnabled, cmuxTail } from './cmux.mjs'

/** How long each state is believed without another event. */
export const TTL = {
  running: 10 * 60 * 1000,
  awaiting: 6 * 60 * 60 * 1000,
  finished: 30 * 60 * 1000,
  errored: 6 * 60 * 60 * 1000,
  unknown: 60 * 1000,
}

/** A tool counts as reporting if it said anything within this long. */
const ACTIVE_MS = 10 * 60 * 1000

const HARNESS = { claude: 'claude-code', codex: 'codex' }
const TOOL_OF = Object.fromEntries(Object.entries(HARNESS).map(([tool, harness]) => [harness, tool]))
const ASKS_YOU = new Set(['permission_prompt', 'elicitation_dialog'])

/**
 * What an event means for its session, per tool: 'running', 'awaiting', 'finished', 'errored',
 * 'ended' (forget the session), or null (not about status).
 */
export function stateFor(tool, e) {
  switch (e.event) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return 'running'
    case 'PermissionRequest':
      return 'awaiting'
    case 'Notification':
      return tool === 'claude' && ASKS_YOU.has(e.notificationType) ? 'awaiting' : null
    case 'Stop':
    case 'Interrupt':
      return 'finished'
    case 'StopFailure':
      return tool === 'claude' ? 'errored' : null
    case 'SessionEnd':
      return 'ended'
    default:
      return null
  }
}

/** Every string a thread might be known by: the tail of its id, and the ids inside its ref. */
function sessionIds(thread) {
  const ids = new Set()
  if (typeof thread.id === 'string') ids.add(thread.id.slice(thread.id.indexOf(':') + 1))
  const ref = thread.ref
  if (ref && typeof ref === 'object') {
    for (const value of Object.values(ref)) {
      if (typeof value === 'string') ids.add(value)
      else if (Array.isArray(value)) for (const v of value) if (typeof v === 'string') ids.add(v)
    }
  }
  ids.delete('')
  return ids
}

function applyEntry(thread, entry) {
  const next = { ...thread, liveSource: entry.source || 'hooks', lastActivityAt: Math.max(thread.lastActivityAt || 0, entry.at) }
  switch (entry.state) {
    case 'running':
      return { ...next, running: true, hasError: false }
    case 'awaiting':
      return { ...next, running: false, hasError: false, unread: true }
    case 'finished':
      // The turn was handed back. It waits on you unless you have looked since — which Codex,
      // recording no focus history, can never say, so for Codex a fresh finish always waits.
      return { ...next, running: false, hasError: false, unread: Boolean(thread.unread) || entry.at > (thread.lastFocusedAt || 0) }
    default:
      return { ...next, running: false, hasError: true }
  }
}

/**
 * Claude's own marker says `busy` for a process that is alive and in the middle of a turn. It is a
 * snapshot rather than an event, so it has no expiry of its own: a long turn is still a turn.
 */
const markerBusy = (thread) => thread.harness === 'claude-code' && thread.markerStatus === 'busy'

export class LiveStatus {
  #tails
  #now
  #entries = new Map()
  #last = { hooks: { claude: 0, codex: 0 }, cmux: { claude: 0, codex: 0 } }
  #queue = Promise.resolve()

  /**
   * `file` is the hooks' events file. `cmuxFile`, when given, adds cmux's stream as a second source;
   * with none there is no cmux source at all (which is what the off switch gives), so it is never opened.
   */
  constructor({ file = eventsFile(), cmuxFile, now = Date.now, maxBytes, seedMs } = {}) {
    this.#now = now
    this.#tails = [{ id: 'hooks', tail: new EventTail(file, { now, maxBytes, seedMs }) }]
    if (cmuxFile) this.#tails.push({ id: 'cmux', tail: cmuxTail(cmuxFile, { now }) })
  }

  get size() {
    return this.#entries.size
  }

  /**
   * Read whatever has been appended since the last call. A burst is drained, up to a point.
   *
   * Calls queue up rather than overlap. Two scans can land together (two tabs, or a click during a
   * poll), and the tail keeps an offset and a half-line between awaits: two readers in it at once
   * would each advance the offset over the same bytes and glue the same partial line twice.
   */
  refresh() {
    const run = this.#queue.then(() => this.#drain())
    this.#queue = run.catch(() => {})
    return run
  }

  async #drain() {
    for (const { id, tail } of this.#tails) {
      for (let i = 0; i < 8; i++) {
        for (const e of await tail.readNew()) this.#take(e, id)
        if (!tail.more) break
      }
    }
  }

  #take(e, source) {
    this.#last[source][e.tool] = Math.max(this.#last[source][e.tool], e.at)
    const state = stateFor(e.tool, e)
    if (state === null) return
    const key = `${e.tool}:${e.sessionId}`
    // Two files feed one map, so what arrives last is not always what happened last. An event only
    // replaces what is known if it is at least as new: an old row read late must not put a bot back
    // in a state it has already left.
    const known = this.#entries.get(key)
    if (known && e.at < known.at) return
    if (state === 'ended') this.#entries.delete(key)
    else this.#entries.set(key, { state, at: e.at, source })
  }

  /** The threads with live status laid over them. Threads and events that do not match are left as they are. */
  overlay(threads) {
    const now = this.#now()
    for (const [key, entry] of this.#entries) {
      if (now - entry.at > TTL[entry.state]) this.#entries.delete(key)
    }
    if (!this.#entries.size && !threads.some(markerBusy)) return threads

    const byKey = new Map()
    threads.forEach((thread, i) => {
      const tool = TOOL_OF[thread.harness]
      if (!tool) return
      for (const id of sessionIds(thread)) {
        const key = `${tool}:${id}`
        if (!byKey.has(key)) byKey.set(key, [])
        byKey.get(key).push(i)
      }
    })

    const out = threads.slice()
    const newest = new Map() // thread index -> the time of the newest event applied to it
    for (const [key, entry] of this.#entries) {
      const matches = byKey.get(key)
      if (!matches) {
        if (now - entry.at > TTL.unknown) this.#entries.delete(key)
        continue
      }
      for (const i of matches) {
        out[i] = applyEntry(out[i], entry)
        newest.set(i, Math.max(newest.get(i) ?? 0, entry.at))
      }
    }

    // Claude's own busy marker competes with the events on time, like any other signal: an event at
    // least as new wins, and a busy stamp newer than the last stop means a new turn has begun.
    threads.forEach((thread, i) => {
      if (!markerBusy(thread)) return
      const at = Number.isFinite(thread.markerAt) ? thread.markerAt : 0
      if ((newest.get(i) ?? -1) >= at) return
      out[i] = applyEntry(out[i], { state: 'running', at, source: 'claude' })
    })
    return out
  }

  /**
   * For the doctor: each source, whether its file is there, why the last read gave nothing (or null when it
   * was read fine), and when it last reported. Kinds and times only; nothing a row said.
   */
  diagnose() {
    const now = this.#now()
    return this.#tails.map(({ id, tail }) => {
      const lastAt = Math.max(0, ...Object.values(this.#last[id]))
      return { id, present: tail.present, problem: tail.problem, lastAt, reporting: Boolean(lastAt && now - lastAt <= ACTIVE_MS) }
    })
  }

  /**
   * For the page: is anything reporting, when did each tool last say something, and which sources
   * exist. A source is listed while its file is there, so the chip can say cmux is quiet rather than
   * saying nothing; `lastAt` is 0 until it has reported.
   */
  summary() {
    const now = this.#now()
    const lastOf = (source) => Math.max(0, ...Object.values(this.#last[source]))
    const sources = this.#tails.map(({ id, tail }) => ({ id, present: tail.present, lastAt: lastOf(id) }))
    const tool = (name) => Math.max(...Object.values(this.#last).map((last) => last[name]))
    return {
      active: sources.some((s) => s.lastAt && now - s.lastAt <= ACTIVE_MS),
      tools: { 'claude-code': tool('claude'), codex: tool('codex') },
      sources,
    }
  }
}

let instance = null
/**
 * One per server, made on first use so the locations are read after the environment is set. cmux's
 * stream is a source unless `MOON_BASE_CMUX_STATUS` switches it off, in which case its file is never opened.
 */
export const liveStatus = () => (instance ??= new LiveStatus({ cmuxFile: cmuxStatusEnabled() ? defaultCmuxFile() : undefined }))
export const resetLiveStatus = () => {
  instance = null
}
