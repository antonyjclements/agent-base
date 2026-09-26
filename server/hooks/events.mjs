/**
 * Events off disk. The hook script appends one small JSON line per event to a file that only the
 * current user can write; this reads them back, refuses anything that is not exactly what the
 * script would have written, and never trusts a file that somebody else could have written to.
 *
 * An event is a display hint. Nothing in here, or in what is built on it, can start anything.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** The events each tool is registered for. The hook script keeps its own copy; a test compares them. */
export const EVENTS = {
  claude: new Set(['UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd']),
  codex: new Set(['UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd']),
}

export const MAX_LINE = 4096
const MAX_READ = 1024 * 1024
const SEED_BYTES = 256 * 1024
export const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/
const clip = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : undefined)

export function eventsFile(env = process.env, home = os.homedir()) {
  return path.join(env.MOON_BASE_HOME || path.join(home, '.moon-base'), 'events', 'events.jsonl')
}

/**
 * One line to one event, or null. A timestamp from the future (or no timestamp) becomes the arrival
 * time: an event may never claim to be newer than it is. An old one stays old.
 */
export function parseEvent(line, now = Date.now()) {
  if (typeof line !== 'string' || line.length === 0 || line.length > MAX_LINE) return null
  let o
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null
  if (typeof o.tool !== 'string' || !Object.hasOwn(EVENTS, o.tool) || !EVENTS[o.tool].has(o.event)) return null
  if (typeof o.sessionId !== 'string' || !SESSION_ID.test(o.sessionId)) return null
  const ts = Number(o.ts)
  const at = Number.isFinite(ts) && ts <= now + 5 * 60 * 1000 ? ts : now
  return {
    tool: o.tool,
    event: o.event,
    sessionId: o.sessionId,
    turnId: clip(o.turnId, 128),
    notificationType: clip(o.notificationType, 64),
    cwd: clip(o.cwd, 512),
    at,
  }
}

/** Only the current user's own file, in the current user's own directory, counts. */
const private_ = (st) => typeof process.getuid !== 'function' || (st.uid === process.getuid() && (st.mode & 0o022) === 0)

/**
 * Follows the events file from where it last stopped. Tolerates everything a log can do: not
 * existing yet, a half-written last line, being truncated or replaced, and growing without limit
 * (past `maxBytes` it is renamed aside once fully read, and the hook script simply starts a new one).
 *
 * The defaults are the hook script's: its own line format, 4 KiB lines, a ten-minute replay of the
 * last 256 KiB, and a file that is Moon Base's to rename. Another source that is *not* Moon Base's
 * (cmux's stream) brings its own `parse` and limits and sets `rotate: false`, because a tail must
 * never rename, move or write a file it did not create.
 *
 * `problem` says why the last read returned nothing, for the page and for the doctor: `unread` (not
 * read yet), `missing`, `not-private` (someone else could write to it, so it is not trusted),
 * `not-a-file`, `unreadable`, or null when it was read.
 */
export class EventTail {
  #file
  #now
  #maxBytes
  #seedMs
  #seedBytes
  #maxLine
  #parse
  #rotate
  #problem = 'unread'
  #identity = ''
  #offset = 0
  #partial = Buffer.alloc(0)
  #seeded = false
  more = false

  constructor(
    file,
    { now = Date.now, maxBytes = 5 * 1024 * 1024, seedMs = 10 * 60 * 1000, seedBytes = SEED_BYTES, maxLine = MAX_LINE, parse = parseEvent, rotate = true } = {}
  ) {
    this.#file = file
    this.#now = now
    this.#maxBytes = maxBytes
    this.#seedMs = seedMs
    this.#seedBytes = seedBytes
    this.#maxLine = maxLine
    this.#parse = parse
    this.#rotate = rotate
  }

  get problem() {
    return this.#problem
  }

  /** The file exists (whether or not it may be read). False before the first read and when it is missing. */
  get present() {
    return this.#problem !== 'unread' && this.#problem !== 'missing'
  }

  #reset(identity = '') {
    this.#identity = identity
    this.#offset = 0
    this.#partial = Buffer.alloc(0)
  }

  async readNew() {
    this.more = false
    let st
    try {
      const dir = await fsp.stat(path.dirname(this.#file))
      st = await fsp.stat(this.#file)
      if (!private_(dir) || !private_(st)) {
        this.#problem = 'not-private'
        return []
      }
      if (!st.isFile()) {
        this.#problem = 'not-a-file'
        return []
      }
    } catch (err) {
      this.#problem = err?.code === 'ENOENT' ? 'missing' : 'unreadable'
      this.#reset()
      return []
    }
    this.#problem = null

    const identity = `${st.dev}:${st.ino}:${st.birthtimeMs}`
    if (identity !== this.#identity || st.size < this.#offset) this.#reset(identity)

    let skipFirst = false
    if (!this.#seeded) {
      // A file that was already there when the server started: replay only its recent tail.
      if (st.size > this.#seedBytes) {
        this.#offset = st.size - this.#seedBytes
        skipFirst = true
      }
    }
    if (st.size === this.#offset) return await this.#rotateIfLarge(st, [])

    const length = Math.min(st.size - this.#offset, MAX_READ)
    const bytes = Buffer.alloc(length)
    try {
      const fh = await fsp.open(this.#file, 'r')
      try {
        const { bytesRead } = await fh.read(bytes, 0, length, this.#offset)
        this.#offset += bytesRead
        var chunk = bytes.subarray(0, bytesRead)
      } finally {
        await fh.close()
      }
    } catch (err) {
      // It is there and passed every check, but cannot be opened or read: say so, or a doctor would call it quiet.
      this.#problem = 'unreadable'
      throw err
    }
    this.more = this.#offset < st.size

    const data = Buffer.concat([this.#partial, chunk])
    const cut = data.lastIndexOf(0x0a)
    this.#partial = cut === -1 ? data : data.subarray(cut + 1)
    if (this.#partial.length > this.#maxLine) this.#partial = Buffer.alloc(0) // a runaway line is dropped, not accumulated
    const complete = cut === -1 ? '' : data.subarray(0, cut).toString('utf8')

    const now = this.#now()
    const events = []
    const lines = complete.split('\n')
    if (skipFirst) lines.shift() // the seek landed mid-line
    for (const l of lines) {
      const e = this.#parse(l, now)
      if (!e) continue
      if (!this.#seeded && e.at < now - this.#seedMs) continue
      events.push(e)
    }
    this.#seeded = true
    return await this.#rotateIfLarge(st, events)
  }

  async #rotateIfLarge(st, events) {
    if (this.#rotate && st.size > this.#maxBytes && this.#offset >= st.size) {
      try {
        await fsp.rename(this.#file, `${this.#file}.1`)
        this.#reset()
      } catch {
        /* somebody else got there first */
      }
    }
    return events
  }
}
