/** Optional visible-screen evidence. No transcript, terminal text or process commands are retained. */
import { stripVTControlCharacters } from 'node:util'
import { cmuxHandle, cmuxProcessTree, cmuxReadScreen } from '../lib/terminal.mjs'

export const screenStatusEnabled = (env = process.env) => /^(on|1|true|yes)$/i.test(env.MOON_BASE_CMUX_SCREEN || '')
const list = value => Array.isArray(value) ? value : []

/** Require a selected option and the active dialog's footer at the bottom, not a phrase in output. */
export function promptOnScreen(text) {
  if (typeof text !== 'string' || text.length > 65536) return null
  const lines = stripVTControlCharacters(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const tail = lines.slice(-16)
  if (tail.some(l => /^```|^>\s/.test(l))) return null
  const footer = tail.at(-1) || ''
  if (!/^(?:Enter to (?:select|confirm|submit).*Esc to cancel|Esc to cancel(?:[ .·].*)?)$/i.test(footer)) return null
  if (!tail.some(l => /^[❯›>]\s*\d+[.)]\s+\S/.test(l))) return null
  if (tail.filter(l => /^(?:[❯›>]\s*)?\d+[.)]\s+\S/.test(l)).length < 2) return null
  if (tail.some(l => /^Would you like to proceed\?$/i.test(l))) return 'plan'
  if (tail.some(l => /^Do you want to (?:proceed|allow.*|run.*|make this edit.*)\?$/i.test(l))) return 'permission'
  if (/^Enter to (?:select|submit).*Esc to cancel/i.test(footer)) return 'question'
  return null
}

function processPids(surface) {
  const pids = new Set(list(surface.top_level_pids).filter(Number.isSafeInteger))
  const pending = [...list(surface.processes)]
  // Bound even malformed/deep process trees; a truncated match will be skipped, never guessed.
  for (let i = 0; pending.length && i < 4096; i++) {
    const p = pending.pop()
    if (!p || typeof p !== 'object') continue
    if (Number.isSafeInteger(p.pid)) pids.add(p.pid)
    for (const pid of list(p.resources?.pids)) if (Number.isSafeInteger(pid)) pids.add(pid)
    pending.push(...list(p.children))
  }
  return pending.length ? new Set() : pids
}

/** Same PID binding cmux uses itself. Never match a title/folder or select an arbitrary duplicate. */
export function matchSurfaces(tree, markers) {
  const surfaces = []
  for (const window of list(tree?.windows)) for (const workspace of list(window?.workspaces)) {
    if (!cmuxHandle(workspace?.id)) continue
    for (const pane of list(workspace.panes)) for (const surface of list(pane?.surfaces)) {
      if (!cmuxHandle(surface?.id)) continue
      surfaces.push({ workspace: workspace.id, surface: surface.id, pids: processPids(surface) })
    }
  }
  const matches = []
  for (const [sessionId, marker] of markers) {
    if (!marker.cli || marker.terminalPids?.length !== 1) continue
    const pid = marker.terminalPids[0]
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    const found = surfaces.filter(s => s.pids.has(pid))
    if (found.length === 1) matches.push({ sessionId, workspace: found[0].workspace, surface: found[0].surface })
  }
  return matches.filter(m => matches.filter(other => other.surface === m.surface).length === 1)
}

export class CmuxScreenStatus {
  #enabled; #top; #read; #now
  #inflight = null
  #checkedAt = -Infinity
  #key = ''
  #cursor = 0
  #evidence = new Map()
  #summary

  constructor({ enabled = screenStatusEnabled(), top = cmuxProcessTree, read = cmuxReadScreen, now = Date.now } = {}) {
    this.#enabled = enabled; this.#top = top; this.#read = read; this.#now = now
    this.#summary = { enabled, problem: enabled ? 'no-sessions' : 'off', matched: 0, checked: 0, waiting: 0, lastAt: 0 }
  }

  get enabled() { return this.#enabled }
  summary() { return { ...this.#summary } }

  async overlay(threads, markers) {
    if (!this.#enabled) return threads
    const ids = new Set(threads.filter(t => t.harness === 'claude-code' && t.terminalLive).map(t => t.ref?.cliSessionId))
    const eligible = new Map([...markers].filter(([id]) => ids.has(id)))
    const key = JSON.stringify([...eligible].map(([id, m]) => [id, m.terminalPids]).sort())
    // Share I/O between simultaneous browser polls, but revalidate eligibility for each caller.
    while (this.#inflight) await this.#inflight
    if (key !== this.#key || this.#now() - this.#checkedAt >= 2000) {
      this.#key = key
      this.#inflight = this.#sample(eligible).finally(() => { this.#inflight = null })
      await this.#inflight
    }
    return threads.map(t => {
      const id = t.ref?.cliSessionId
      const entry = eligible.has(id) && this.#evidence.get(id)
      if (!entry || this.#now() - entry.at > 5000 || Math.max(t.markerAt || 0, t.transcriptStatus?.at || 0, t.lastActivityAt || 0) > entry.at) return t
      return { ...t, running: false, unread: true, hasError: false, liveSource: 'cmux-screen', waitingReason: entry.reason }
    })
  }

  async #sample(markers) {
    this.#evidence.clear()
    this.#summary = { enabled: true, problem: 'no-sessions', matched: 0, checked: 0, waiting: 0, lastAt: 0 }
    try {
      if (!markers.size) return
      const tree = await this.#top()
      if (!Array.isArray(tree?.windows)) { this.#summary.problem = 'unavailable'; return }
      const matches = matchSurfaces(tree, markers)
      this.#summary.matched = matches.length
      if (!matches.length) { this.#summary.problem = 'no-match'; return }
      // At most sixteen short reads at once, with fair rotation for larger colonies.
      const start = this.#cursor % matches.length
      const batch = [...matches.slice(start), ...matches.slice(0, start)].slice(0, 16)
      this.#cursor = (start + batch.length) % matches.length
      await Promise.all(batch.map(async target => {
        try {
          const text = await this.#read(target)
          if (typeof text !== 'string') return
          const at = this.#now()
          this.#summary.checked++
          this.#summary.lastAt = at
          const reason = promptOnScreen(text)
          if (reason) this.#evidence.set(target.sessionId, { reason, at })
        } catch { /* fixed diagnostic below, never the command's error text */ }
      }))
      this.#summary.waiting = this.#evidence.size
      this.#summary.problem = this.#summary.checked === batch.length ? null : 'read-failed'
    } catch { this.#summary.problem = 'unavailable' }
    finally { this.#checkedAt = this.#now() }
  }
}

let instance
export const cmuxScreenStatus = () => (instance ??= new CmuxScreenStatus())
export const resetCmuxScreenStatus = (options) => { instance = options ? new CmuxScreenStatus(options) : undefined }
