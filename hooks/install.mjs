/**
 * The installer's library: plan a change to a tool's config, show it, and apply it safely.
 *
 * This is the only code in Moon Base that ever edits a tool's config, and it lives here, outside
 * `server/`, so that nothing reachable over HTTP can. Everything is built around one promise: what
 * the person is shown is exactly what is written, and what is written is exactly reversible.
 *
 *   - Planning reads and writes nothing. It returns the before, the after and the diff.
 *   - Applying re-reads the file first and refuses if it is not what was planned against (Claude Code
 *     and Codex both rewrite their own config, so a review can go stale), writes a temp file beside it
 *     and renames it into place, keeps the file's permissions, and follows a symlink to the real file.
 *   - Our entries are appended after the user's, never reordered: Codex trusts a hook by its position.
 *   - A small record notes what we created, so uninstalling puts back exactly what was there.
 */
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { unifiedDiff } from './diff.mjs'
import { parseEvent } from '../server/hooks/events.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const TOOLS = ['claude', 'codex']
export const LABEL = { claude: 'Claude Code', codex: 'Codex' }

/**
 * The events each tool is asked to report, and whether the hook may run in the background. The
 * terminal ones (Stop, StopFailure, SessionEnd) run in the foreground: a background hook fired right
 * before the process exits can be lost. PreToolUse and SessionStart are left out on purpose: Codex
 * prints two visible lines per hook per event.
 */
const EVENTS = {
  claude: [
    ['UserPromptSubmit', { async: true }],
    ['PostToolUse', { async: true }],
    ['PermissionRequest', { async: true }],
    ['Notification', { async: true, matcher: 'permission_prompt|elicitation_dialog' }],
    ['Stop', {}],
    ['StopFailure', {}],
    ['SessionEnd', {}],
  ],
  codex: [
    ['UserPromptSubmit', { async: true }],
    ['PostToolUse', { async: true }],
    ['PermissionRequest', { async: true }],
    ['Stop', {}],
    ['SessionEnd', {}],
  ],
}

export function locations({ env = process.env, home = os.homedir() } = {}) {
  const moon = env.MOON_BASE_HOME || path.join(home, '.moon-base')
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  const codexDir = env.CODEX_HOME || path.join(home, '.codex')
  return {
    moon,
    bin: path.join(moon, 'bin'),
    record: path.join(moon, 'install.json'),
    events: path.join(moon, 'events', 'events.jsonl'),
    claude: path.join(claudeDir, 'settings.json'),
    codexHooks: path.join(codexDir, 'hooks.json'),
    codexConfig: path.join(codexDir, 'config.toml'),
  }
}

// ── small helpers ─────────────────────────────────────────────────────────────

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const plain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isGroup = (g) => plain(g) && Array.isArray(g.hooks)
const quote = (p) => (/^[A-Za-z0-9_./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)
const commandFor = (loc, tool) => `${quote(path.join(loc.bin, 'moon-base-hook'))} ${tool}`
const oursFor = (tool) => (h) => plain(h) && typeof h.command === 'string' && new RegExp(`moon-base-hook'?\\s+${tool}\\s*$`).test(h.command)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function readIfExists(file) {
  let target
  try {
    target = await fsp.realpath(file)
  } catch {
    return { exists: false, target: file, text: '', sha: '', mode: 0o600 }
  }
  const [text, st] = await Promise.all([fsp.readFile(target, 'utf8'), fsp.stat(target)])
  return { exists: true, target, text, sha: sha(text), mode: st.mode & 0o777 }
}

function parseObject(text) {
  let v
  try {
    v = JSON.parse(text)
  } catch (err) {
    throw new Error(`it is not valid JSON (${err.message})`)
  }
  if (!plain(v)) throw new Error('it is not a JSON object')
  return v
}

const indentOf = (text) => {
  const m = /^([ \t]+)"/m.exec(text)
  return m ? (m[1][0] === '\t' ? '\t' : m[1].length) : 2
}
const serialize = (obj, text) => `${JSON.stringify(obj, null, indentOf(text))}\n`

/** Write beside the target and rename over it, so a crash can never leave half a config. */
async function writeAtomic(target, data, mode) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.moon-base-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`)
  const fh = await fsp.open(tmp, 'wx', mode)
  try {
    await fh.writeFile(data)
    await fh.sync()
  } catch (err) {
    await fh.close().catch(() => {})
    await fsp.rm(tmp, { force: true })
    throw err
  }
  await fh.close()
  try {
    await fsp.chmod(tmp, mode)
    await fsp.rename(tmp, target)
  } catch (err) {
    await fsp.rm(tmp, { force: true })
    throw err
  }
}

async function readRecord(loc) {
  try {
    const r = JSON.parse(await fsp.readFile(loc.record, 'utf8'))
    return plain(r) ? r : {}
  } catch {
    return {}
  }
}

async function writeRecord(loc, record) {
  if (!Object.keys(record).length) return fsp.rm(loc.record, { force: true })
  await fsp.mkdir(loc.moon, { recursive: true, mode: 0o700 })
  return writeAtomic(loc.record, `${JSON.stringify(record, null, 2)}\n`, 0o600)
}

// ── planning ──────────────────────────────────────────────────────────────────

function desiredGroup(loc, tool, spec) {
  const handler = { type: 'command', command: commandFor(loc, tool) }
  if (spec.async) handler.async = true
  handler.timeout = tool === 'codex' ? 3 : 5
  return spec.matcher ? { matcher: spec.matcher, hooks: [handler] } : { hooks: [handler] }
}

/** Apply the change to a copy of the parsed config. Returns the copy, or an error naming what was odd. */
function edit(tool, mode, obj, loc, record) {
  const isOurs = oursFor(tool)
  const next = structuredClone(obj)
  const result = { next, modified: false, present: 0, found: 0, createdHooksKey: false, removed: false }

  if (next.hooks === undefined) {
    if (mode === 'install') {
      next.hooks = {}
      result.createdHooksKey = true
      result.modified = true
    }
  } else if (!plain(next.hooks)) {
    return { error: '"hooks" is not an object' }
  }

  for (const [event, spec] of EVENTS[tool]) {
    const groups = next.hooks?.[event]
    if (groups === undefined) {
      if (mode === 'install') {
        next.hooks[event] = [desiredGroup(loc, tool, spec)]
        result.modified = true
      }
      continue
    }
    if (!Array.isArray(groups)) return { error: `hooks.${event} is not a list` }
    if (!groups.every(isGroup)) return { error: `hooks.${event} has an entry that is not a hook group` }

    const ours = groups.filter((g) => g.hooks.some(isOurs))
    if (ours.length) result.found++
    const wanted = desiredGroup(loc, tool, spec)

    if (mode === 'install') {
      if (ours.length === 1 && same(ours[0], wanted)) {
        result.present++
        continue
      }
      const kept = groups
        .map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isOurs(h)) }))
        .filter((g, i) => g.hooks.length || !groups[i].hooks.some(isOurs))
      next.hooks[event] = [...kept, wanted]
      result.modified = true
    } else if (ours.length) {
      const kept = groups
        .map((g) => (g.hooks.some(isOurs) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
        .filter((g) => g.hooks.length)
      if (kept.length) next.hooks[event] = kept
      else delete next.hooks[event]
      result.removed = true
      result.modified = true
    }
  }

  if (mode === 'uninstall' && result.removed && plain(next.hooks) && !Object.keys(next.hooks).length && record.createdHooksKey !== false) {
    delete next.hooks
  }
  return result
}

async function plan(tool, mode, ctx) {
  const loc = locations(ctx)
  const file = tool === 'claude' ? loc.claude : loc.codexHooks
  const cur = await readIfExists(file)
  const record = (await readRecord(loc))[tool] || {}
  const base = {
    tool,
    kind: mode,
    file,
    target: cur.target,
    exists: cur.exists,
    sha: cur.sha,
    mode: cur.mode,
    before: cur.text,
    after: cur.text,
    changed: false,
    delete: false,
    diff: '',
    notes: [],
    present: 0,
    expected: EVENTS[tool].length,
    found: 0,
    createdFile: false,
    createdHooksKey: false,
  }

  let obj = {}
  if (cur.exists) {
    try {
      obj = parseObject(cur.text)
    } catch (err) {
      return { ...base, error: `${file}: ${err.message}` }
    }
  }
  const r = edit(tool, mode, obj, loc, record)
  if (r.error) return { ...base, error: `${file}: ${r.error}` }
  base.present = r.present
  base.found = r.found
  base.createdHooksKey = r.createdHooksKey

  if (!r.modified) {
    base.notes.push(mode === 'install' ? 'Already installed; nothing to change.' : 'There is nothing of Moon Base’s in this file.')
    return base
  }

  let after = serialize(r.next, cur.text)
  let remove = false
  if (mode === 'uninstall' && !Object.keys(r.next).length && record.createdFile) {
    remove = true
    after = ''
  }
  base.changed = true
  base.after = after
  base.delete = remove
  base.createdFile = mode === 'install' && !cur.exists
  base.diff = unifiedDiff(cur.text, after, file, { isNew: !cur.exists })

  if (cur.exists && !remove && serialize(obj, cur.text) !== cur.text) {
    base.notes.push('This file’s formatting is not the standard two-space JSON, so it will be re-indented as it is written. Its contents are unchanged.')
  }
  if (mode === 'install' && !cur.exists && !fs.existsSync(path.dirname(file))) {
    base.notes.push(`This creates ${path.dirname(file)}, which does not exist yet (${LABEL[tool]} may not be installed).`)
  }
  if (tool === 'codex' && mode === 'install') {
    try {
      const toml = await fsp.readFile(loc.codexConfig, 'utf8')
      if (/^\s*\[\[?\s*hooks\.(?!state\b)/m.test(toml)) {
        base.notes.push('Your Codex config.toml defines hooks inline. Codex loads it and hooks.json together and prints a warning at startup; both keep working.')
      }
    } catch {
      /* no config.toml, or unreadable: nothing to warn about */
    }
    base.notes.push('Codex will not run these hooks until you trust them: start Codex, run /hooks, and trust the Moon Base entries.')
  }
  return base
}

export const planInstall = (tool, ctx) => plan(tool, 'install', ctx)
export const planUninstall = (tool, ctx) => plan(tool, 'uninstall', ctx)

// ── applying ──────────────────────────────────────────────────────────────────

export async function applyPlan(p, ctx) {
  if (p.error) throw new Error(p.error)
  if (!p.changed) return { wrote: false }
  const loc = locations(ctx)

  const now = await readIfExists(p.file)
  if (now.exists !== p.exists || (p.exists && now.sha !== p.sha)) {
    throw Object.assign(new Error(`${p.file} changed while you were reviewing it, so nothing was written. Run the command again.`), { code: 'CHANGED' })
  }

  if (p.delete) {
    await fsp.unlink(now.target)
  } else {
    if (!p.exists) await fsp.mkdir(path.dirname(p.file), { recursive: true, mode: 0o700 })
    await writeAtomic(now.target, p.after, p.exists ? now.mode : 0o600)
  }

  const record = await readRecord(loc)
  if (p.kind === 'install') {
    const prev = record[p.tool] || {}
    record[p.tool] = {
      file: p.file,
      createdFile: Boolean(prev.createdFile || p.createdFile),
      createdHooksKey: Boolean(prev.createdHooksKey || p.createdHooksKey),
    }
  } else {
    delete record[p.tool]
  }
  await writeRecord(loc, record)
  return { wrote: true }
}

// ── the files that sit next to the tools' configs ─────────────────────────────

async function copyAtomic(from, to, mode) {
  await writeAtomic(to, await fsp.readFile(from), mode)
}

/** The wrapper the tools run, the script it runs, and the Node it should use. */
export async function installSupportFiles(ctx) {
  const loc = locations(ctx)
  await fsp.mkdir(loc.bin, { recursive: true, mode: 0o700 })
  await fsp.chmod(loc.bin, 0o700)
  await copyAtomic(path.join(HERE, 'moon-base-hook'), path.join(loc.bin, 'moon-base-hook'), 0o755)
  await copyAtomic(path.join(HERE, 'moon-base-hook.mjs'), path.join(loc.bin, 'moon-base-hook.mjs'), 0o644)
  await writeAtomic(path.join(loc.bin, 'node-path'), `${process.execPath}\n`, 0o644)
}

/** Take the wrapper and script away. The events stay: they are the person's, and harmless. */
export async function removeSupportFiles(ctx) {
  const loc = locations(ctx)
  await fsp.rm(loc.bin, { recursive: true, force: true })
  await fsp.rm(loc.record, { force: true })
  await fsp.rmdir(loc.moon).catch(() => {})
}

/**
 * Which tools' configs still point at the shared hook. Read from the configs themselves, not from the
 * install record: the record is bookkeeping and can be lost, and getting this wrong deletes the hook
 * out from under a tool that still calls it.
 */
export async function installedTools(ctx) {
  const still = []
  for (const tool of TOOLS) {
    const p = await planInstall(tool, ctx)
    // An unreadable config counts as "still in use": better to leave the hook than to pull it.
    if (p.error || p.found > 0) still.push(tool)
  }
  return still
}

// ── status ────────────────────────────────────────────────────────────────────

/** The newest event per tool in the events file, or 0. Only a file that is private to the user counts. */
async function lastEvents(loc) {
  const out = { claude: 0, codex: 0 }
  try {
    const [dir, file] = await Promise.all([fsp.stat(path.dirname(loc.events)), fsp.stat(loc.events)])
    const mine = (st) => typeof process.getuid !== 'function' || (st.uid === process.getuid() && (st.mode & 0o022) === 0)
    if (!mine(dir) || !mine(file)) return out
    const size = Math.min(file.size, 256 * 1024)
    const fh = await fsp.open(loc.events, 'r')
    try {
      const buf = Buffer.alloc(size)
      await fh.read(buf, 0, size, file.size - size)
      const now = Date.now()
      for (const l of buf.toString('utf8').split('\n')) {
        const e = parseEvent(l, now)
        if (e) out[e.tool] = Math.max(out[e.tool], e.at)
      }
    } finally {
      await fh.close()
    }
  } catch {
    /* no events yet */
  }
  return out
}

export async function status(ctx) {
  const loc = locations(ctx)
  const last = await lastEvents(loc)
  const out = {}
  for (const tool of TOOLS) {
    const p = await planInstall(tool, ctx)
    const s = { file: p.file, installed: false, partly: false, lastEventAt: last[tool], advice: '' }
    if (p.error) {
      out[tool] = { ...s, error: p.error, advice: 'This file could not be read as a hooks config, so nothing was checked.' }
      continue
    }
    s.installed = p.exists && p.present === p.expected && !p.changed
    s.partly = !s.installed && p.found > 0
    if (s.partly) s.advice = 'Partly installed: some entries are missing or out of date. Run install-hooks again.'
    else if (s.installed && !s.lastEventAt) {
      s.advice =
        tool === 'codex'
          ? 'Installed, but no event has been received yet. Codex skips hooks it has not trusted: start Codex and run /hooks to review and trust them.'
          : 'Installed, but no event has been received yet. Start a new Claude Code session and it should report.'
    }
    out[tool] = s
  }
  return out
}
