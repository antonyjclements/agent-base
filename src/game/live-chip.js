/**
 * The Live chip's text and tooltip (AC14), from what the server says about its live sources.
 *
 * It names cmux only while cmux's stream is there: ● when it has reported lately, ○ when it is
 * present but quiet, and not at all when it is absent or switched off (the server then does not list
 * it). Split out of the HUD so it can be tested without a DOM.
 */
const FRESH_MS = 10 * 60 * 1000

/** `{ text, title }`, or null when nothing is reporting and the chip stays hidden. */
export function liveChip(live, now = Date.now()) {
  if (!live?.active) return null
  const dot = (at) => (at && now - at < FRESH_MS ? '●' : '○')
  const sources = Array.isArray(live.sources) ? live.sources.filter((s) => s && typeof s === 'object') : []
  const cmux = sources.find((s) => s.id === 'cmux' && s.present)

  let text = `Live · Claude Code ${dot(live.tools?.['claude-code'])} Codex ${dot(live.tools?.codex)}`
  if (cmux) text += ` · cmux ${dot(cmux.lastAt)}`

  const reporting = sources.filter((s) => s.lastAt && now - s.lastAt < FRESH_MS).map((s) => s.id)
  const names = reporting.length ? reporting.join(' and ') : 'hooks'
  let title = `Live status from ${names}. ● reported in the last ten minutes; ○ is being inferred from that tool’s files.`
  if (cmux && !(cmux.lastAt && now - cmux.lastAt < FRESH_MS)) title += ' cmux is there but has said nothing lately.'
  return { text, title }
}
