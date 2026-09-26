import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Fixtures shared by the harness, scan, status and read-only tests: a Codex home and a Claude Code
 * install faked on disk, so nothing here ever reads a real one.
 */

export const line = (type, payload, timestamp = '2026-09-07T12:00:00.000Z') => JSON.stringify({ timestamp, type, payload })

/** One id for every fixture, so a test can name it before the transcript exists. */
export const SESSION_ID = '019cc762-45a2-7112-89cd-cd345c17e834'

export async function fakeCodex(records) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-fixture-'))
  const day = path.join(home, 'sessions', '2026', '09', '07')
  await fsp.mkdir(day, { recursive: true })
  await fsp.writeFile(path.join(day, `rollout-2026-09-07T12-00-00-${SESSION_ID}.jsonl`), records.join('\n') + '\n')
  return home
}

export async function scanWith(home) {
  process.env.CODEX_HOME = home
  const mod = await import(`../../server/harnesses/codex.mjs?${home}`)
  return mod.default
}

/**
 * Both stores under one temp root: the CLI's home (`CLAUDE_CONFIG_DIR`, so `projects/` and
 * `sessions/` sit inside it) and the desktop app's session store (`MOON_BASE_CLAUDE_DESKTOP`),
 * with one transcript for SESSION_ID and whatever records and deletion markers a test asks for.
 */
export async function fakeClaude({ transcript, records = [], deleted = [] }) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-fixture-'))
  const configDir = path.join(root, 'claude')
  const desktop = path.join(root, 'claude-code-sessions')
  const project = path.join(configDir, 'projects', '-tmp-demo')
  const org = path.join(desktop, 'account', 'org')
  await fsp.mkdir(project, { recursive: true })
  await fsp.mkdir(org, { recursive: true })
  await fsp.writeFile(path.join(project, `${SESSION_ID}.jsonl`), transcript.map((r) => JSON.stringify(r)).join('\n') + '\n')
  for (const r of records) await fsp.writeFile(path.join(org, `${r.sessionId}.json`), JSON.stringify(r))
  // What the app leaves behind when a thread is deleted: the time, under the CLI session's id.
  for (const id of deleted) await fsp.writeFile(path.join(org, `deleted_${id}`), String(Date.now()))
  return { root, configDir, desktop, org }
}

export async function claudeWith({ configDir, desktop }) {
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.MOON_BASE_CLAUDE_DESKTOP = desktop
  const mod = await import(`../../server/harnesses/claude-code.mjs?${configDir}`)
  return mod.default
}

export const typed = (text) => ({
  type: 'user',
  cwd: '/tmp/demo',
  timestamp: '2026-09-07T12:00:00.000Z',
  message: { role: 'user', content: text },
})

/** Every file under a fixture, with size and mtime — what a read-only scan has to leave alone. */
export async function listing(dir) {
  const out = []
  for (const e of await fsp.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue
    const file = path.join(e.parentPath, e.name)
    const st = await fsp.stat(file)
    out.push([path.relative(dir, file), st.size, st.mtimeMs])
  }
  return out.sort()
}

/**
 * cmux's event stream, faked. The rows have the shape a real `~/.cmuxterm/workstream.jsonl` row has
 * (`context`, `createdAt`, `cwd`, `id`, `kind`, `payload`, `ppid`, `source`, `status`, `title`,
 * `updatedAt`, `workstreamId`), with invented content. Every field that can hold message content holds
 * SENTINEL, so a test can prove none of it travels anywhere. Never copy a real row into this repo.
 */
export const SENTINEL = 'SENTINEL-do-not-leak-7f3a91'

/** base64 the way cmux writes it in `workstreamId`; padded or not, the reader has to take both. */
export const b64 = (s, padded = false) => {
  const out = Buffer.from(s).toString('base64')
  return padded ? out : out.replace(/=+$/, '')
}

export function cmuxRow({ kind = 'toolUse', source = 'claude', sessionId = SESSION_ID, cwd = '/tmp/demo', at = Date.now(), workstreamId, extra = {} } = {}) {
  const iso = new Date(at).toISOString().replace(/\.\d+Z$/, 'Z')
  const pending = kind === 'permissionRequest' || kind === 'question'
  return JSON.stringify({
    id: randomUUID(),
    kind,
    source,
    cwd,
    createdAt: iso,
    updatedAt: iso,
    // `undefined` means "the right one"; `null`, `''` and the rest are passed through as the bad values they are.
    workstreamId: workstreamId === undefined ? `cmux-feed-v1:${b64(source)}:${b64(sessionId)}` : workstreamId,
    ppid: 1234,
    status: pending ? { pending: {} } : { telemetry: {} },
    title: `${SENTINEL} title`,
    context: { note: SENTINEL },
    payload: { [kind]: { text: SENTINEL, toolName: 'Bash', toolInputJSON: SENTINEL, resultJSON: SENTINEL, questions: [SENTINEL] } },
    ...extra,
  })
}

/** A `~/.cmuxterm` folder (mode 0700) with a `workstream.jsonl` that `append` adds rows to (mode 0644, as cmux's is). */
export async function fakeCmux() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cmux-fixture-'))
  await fsp.chmod(dir, 0o700)
  const file = path.join(dir, 'workstream.jsonl')
  const append = async (...rows) => {
    await fsp.appendFile(file, rows.join('\n') + '\n')
    await fsp.chmod(file, 0o644)
  }
  return { dir, file, append, rm: () => fsp.rm(dir, { recursive: true, force: true }) }
}

/** Claude Code's own live-session marker, `<config>/sessions/<pid>.json`, as the CLI writes it. */
export async function writeMarker(configDir, { pid = process.pid, sessionId = SESSION_ID, status = 'busy', at = Date.now(), extra = {} } = {}) {
  const dir = path.join(configDir, 'sessions')
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(
    path.join(dir, `${pid}.json`),
    JSON.stringify({ pid, sessionId, cwd: '/tmp/demo', kind: 'interactive', status, statusUpdatedAt: at, updatedAt: at, ...extra })
  )
}
