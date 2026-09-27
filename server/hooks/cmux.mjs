/**
 * cmux's own event stream as a live source (AC14).
 *
 * cmux keeps `~/.cmuxterm/workstream.jsonl`, an append-only line per thing an agent does in one of
 * its terminals: a prompt, a tool call and its result, a permission request or question waiting on
 * you, a stop, an end. That is what Moon Base's own hooks report, so a row is turned into the same
 * normalised event and everything after it (states, expiry, layering over the scan) is the code
 * that already handles hooks. Nothing here can start anything, and nothing here writes.
 *
 * Two rules matter more than the rest.
 *
 *   - **Metadata only.** A row also carries message content: the prompt text, tool inputs and
 *     results, the questions asked. Only five things are read from it (its kind, its tool, its
 *     folder, its time and the session id in `workstreamId`) and the parsed row is dropped the
 *     moment they are picked. Nothing else is kept, logged, served or shown.
 *   - **Not ours.** cmux owns the file. It is never renamed, rotated, truncated or written, and the
 *     format (`cmux-feed-v1`) is undocumented, so anything that is not exactly what was observed is
 *     ignored rather than guessed at: the files simply decide, as they did before.
 */
import os from 'node:os'
import path from 'node:path'
import { EventTail, SESSION_ID } from './events.mjs'

/** Rows carry tool inputs, so they are far longer than a hook line. Longer than this is skipped. */
export const CMUX_MAX_LINE = 512 * 1024
/**
 * On start, replay as far back as the longest state is believed (a permission prompt left waiting is
 * good for six hours), and no more than a mebibyte of file.
 */
const CMUX_SEED_MS = 6 * 60 * 60 * 1000
const CMUX_SEED_BYTES = 1024 * 1024

const FUTURE_MS = 5 * 60 * 1000

/**
 * cmux's kind, onto the hook event that means the same. `sessionStart` is deliberately absent: a session
 * starting says nothing about what it is doing. `question` is a request waiting on you, exactly like a
 * permission request (its payload has the same shape, and cmux marks both `status: pending`).
 */
const EVENT_OF = new Map([
  ['userPrompt', 'UserPromptSubmit'],
  ['toolUse', 'PostToolUse'],
  ['toolResult', 'PostToolUse'],
  ['permissionRequest', 'PermissionRequest'],
  ['question', 'PermissionRequest'],
  ['stop', 'Stop'],
  ['sessionEnd', 'SessionEnd'],
])

const TOOLS = new Set(['claude', 'codex'])
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/
const clip = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : undefined)

export function cmuxDir(env = process.env, home = os.homedir()) {
  return env.MOON_BASE_CMUX_DIR || path.join(home, '.cmuxterm')
}

export function cmuxFile(env = process.env, home = os.homedir()) {
  return path.join(cmuxDir(env, home), 'workstream.jsonl')
}

/** On unless `MOON_BASE_CMUX_STATUS` says off, 0, false or no (any case). Anything else leaves it on. */
export function cmuxStatusEnabled(env = process.env) {
  return !['off', '0', 'false', 'no'].includes(String(env.MOON_BASE_CMUX_STATUS ?? '').toLowerCase())
}

const unbase64 = (s) => (BASE64.test(s) ? Buffer.from(s, 'base64').toString('utf8') : null)

/**
 * The session id inside `cmux-feed-v1:<base64 source>:<base64 id>`, or null. It is accepted only when
 * there are exactly three parts, the first is the format's name, the source decodes to the row's own
 * `source`, and the id passes the same pattern every other session id here has to.
 */
function sessionOf(workstreamId, source) {
  if (typeof workstreamId !== 'string' || workstreamId.length > 512) return null
  const parts = workstreamId.split(':')
  if (parts.length !== 3 || parts[0] !== 'cmux-feed-v1') return null
  const decodedSource = unbase64(parts[1])
  const id = unbase64(parts[2])
  if (decodedSource !== source || id === null || !SESSION_ID.test(id)) return null
  return id
}

/**
 * One line of `workstream.jsonl` to one normalised event, or null. The event has exactly the fields a hook
 * event has (`tool`, `event`, `sessionId`, `cwd`, `at`), and a time from the future (or none) becomes the
 * arrival time: a row may never claim to be newer than it is.
 *
 * cmux stamps a row with whole seconds (`2026-09-26T16:46:08Z`), so `at` is up to a second older than the
 * moment it describes. That is harmless inside one file, where order is the order of the lines. But when hooks
 * and cmux both report the same session, two events less than a second apart can be ranked either way by the
 * newest-wins rule in `live.mjs`. The cost is a state that is briefly wrong: the next event corrects it, and
 * every state expires back to the files.
 */
export function parseCmuxRow(line, now = Date.now()) {
  if (typeof line !== 'string' || line.length === 0 || line.length > CMUX_MAX_LINE) return null
  let row
  try {
    row = JSON.parse(line)
  } catch {
    return null
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null

  const event = typeof row.kind === 'string' ? EVENT_OF.get(row.kind) : undefined
  if (!event) return null
  const tool = row.source
  if (typeof tool !== 'string' || !TOOLS.has(tool)) return null
  const sessionId = sessionOf(row.workstreamId, tool)
  if (!sessionId) return null

  const ts = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : NaN
  const at = Number.isFinite(ts) && ts <= now + FUTURE_MS ? ts : now
  return { tool, event, sessionId, cwd: clip(row.cwd, 512), at }
}

/** A tail on cmux's file: its parser and limits, and never a rename. `options` are for tests. */
export const cmuxTail = (file, options = {}) =>
  new EventTail(file, {
    parse: parseCmuxRow,
    maxLine: CMUX_MAX_LINE,
    seedBytes: CMUX_SEED_BYTES,
    seedMs: CMUX_SEED_MS,
    rotate: false,
    ...options,
  })
