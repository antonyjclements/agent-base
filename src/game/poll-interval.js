// @spec MB-016
/** File-only terminal sessions need the same cadence as hook-driven sessions. */
export function pollInterval(live) {
  return live?.active || live?.terminalSessions > 0 ? 3000 : 15000
}
