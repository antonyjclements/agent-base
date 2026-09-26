/**
 * Live status: what the hooks say each session is doing right now, laid over what the adapters
 * read from the files.
 *
 * The hooks are a hint, never a source of bots. An event colours a thread the scan already found and
 * does nothing else; an event for a session nobody has scanned is held for a minute in case the
 * scan is a step behind, then forgotten. Every state has a limit, so a tool that stops reporting
 * hands its threads straight back to what their files say, with no error and nothing to do.
 */
import { EventTail, eventsFile } from './events.mjs'

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
  const next = { ...thread, liveSource: 'hooks', lastActivityAt: Math.max(thread.lastActivityAt || 0, entry.at) }
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

export class LiveStatus {
  #tail
  #now
  #entries = new Map()
  #last = { claude: 0, codex: 0 }
  #queue = Promise.resolve()

  constructor({ file = eventsFile(), now = Date.now, maxBytes, seedMs } = {}) {
    this.#now = now
    this.#tail = new EventTail(file, { now, maxBytes, seedMs })
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
    for (let i = 0; i < 8; i++) {
      for (const e of await this.#tail.readNew()) this.#take(e)
      if (!this.#tail.more) break
    }
  }

  #take(e) {
    this.#last[e.tool] = Math.max(this.#last[e.tool], e.at)
    const state = stateFor(e.tool, e)
    if (state === null) return
    const key = `${e.tool}:${e.sessionId}`
    if (state === 'ended') this.#entries.delete(key)
    else this.#entries.set(key, { state, at: e.at })
  }

  /** The threads with live status laid over them. Threads and events that do not match are left as they are. */
  overlay(threads) {
    const now = this.#now()
    for (const [key, entry] of this.#entries) {
      if (now - entry.at > TTL[entry.state]) this.#entries.delete(key)
    }
    if (!this.#entries.size) return threads

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
    for (const [key, entry] of this.#entries) {
      const matches = byKey.get(key)
      if (!matches) {
        if (now - entry.at > TTL.unknown) this.#entries.delete(key)
        continue
      }
      for (const i of matches) out[i] = applyEntry(out[i], entry)
    }
    return out
  }

  /** For the page: is anything reporting, and when did each tool last say something. */
  summary() {
    const now = this.#now()
    return {
      active: Object.values(this.#last).some((at) => at && now - at <= ACTIVE_MS),
      tools: { 'claude-code': this.#last.claude, codex: this.#last.codex },
    }
  }
}

let instance = null
/** One per server, made on first use so the events location is read after the environment is set. */
export const liveStatus = () => (instance ??= new LiveStatus())
export const resetLiveStatus = () => {
  instance = null
}
