#!/usr/bin/env node
/**
 * The hook Claude Code and Codex run on every event Moon Base asks for.
 *
 *     node moon-base-hook.mjs claude|codex     (the tool's event JSON arrives on stdin)
 *
 * It has one job: append a small, fixed-shape line to the events file, which the server reads.
 * Everything else about it is restraint, because it runs inside somebody else's tool:
 *
 *   - It never prints and always exits 0, so it cannot show up in a session or block one.
 *   - It records which tool, which event and which session — never a prompt, a tool call, a
 *     reply or a transcript path. Whatever else the tool sends is dropped on the floor.
 *   - It reads a bounded amount of input and writes a bounded line.
 *   - It writes only into a directory that belongs to the current user and that nobody else
 *     can write to, and only to a regular file it opened without following a link.
 *
 * Deliberately standalone: it is copied next to the user's tool config and must keep working when
 * the rest of the project is not there, so it imports nothing but Node's own modules. The server
 * keeps its own copy of the allow-list, and a test fails if the two drift apart.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const EVENTS = {
  claude: ['UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'],
  codex: ['UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd'],
}

const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/
const MAX_INPUT = 1024 * 1024
const clip = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : undefined)

/** The line to append for one event, or null when it is not one we record. */
export function buildLine(tool, payload, now = Date.now()) {
  if (!Object.hasOwn(EVENTS, tool)) return null
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const event = payload.hook_event_name
  if (typeof event !== 'string' || !EVENTS[tool].includes(event)) return null
  const sessionId = payload.session_id
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null
  const line = JSON.stringify({
    v: 1,
    ts: now,
    tool,
    event,
    sessionId,
    turnId: clip(payload.turn_id, 128),
    notificationType: clip(payload.notification_type, 64),
    cwd: clip(payload.cwd, 512),
  })
  return line.length < 4096 ? line : null
}

function readStdin(limit) {
  const chunks = []
  let total = 0
  const buf = Buffer.alloc(64 * 1024)
  let waited = 0
  for (;;) {
    let n
    try {
      n = fs.readSync(0, buf, 0, buf.length, null)
    } catch (err) {
      // A pipe that has nothing yet: wait a moment rather than give up, but not for long.
      if (err.code === 'EAGAIN' && waited < 2000) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
        waited += 10
        continue
      }
      if (err.code === 'EOF') break
      return null
    }
    if (n === 0) break
    total += n
    if (total > limit) return null
    chunks.push(Buffer.from(buf.subarray(0, n)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const ours = (st) => typeof process.getuid !== 'function' || (st.uid === process.getuid() && (st.mode & 0o022) === 0)

/** Append one line, but only somewhere that is private to this user. */
export function record(line, env = process.env, home = os.homedir()) {
  const dir = path.join(env.MOON_BASE_HOME || path.join(home, '.moon-base'), 'events')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dirStat = fs.lstatSync(dir)
  if (!dirStat.isDirectory() || !ours(dirStat)) return false
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0)
  const fd = fs.openSync(path.join(dir, 'events.jsonl'), flags, 0o600)
  try {
    const st = fs.fstatSync(fd)
    if (!st.isFile() || !ours(st)) return false
    fs.writeSync(fd, `${line}\n`)
    return true
  } finally {
    fs.closeSync(fd)
  }
}

function main() {
  try {
    const tool = process.argv[2]
    if (!Object.hasOwn(EVENTS, tool) || process.stdin.isTTY) return
    const raw = readStdin(MAX_INPUT)
    if (raw === null) return
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    const line = buildLine(tool, payload)
    if (line) record(line)
  } catch {
    /* whatever went wrong, the tool that called us must never know */
  }
}

const isMain = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isMain) {
  main()
  process.exitCode = 0
}
