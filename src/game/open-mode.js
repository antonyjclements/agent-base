/**
 * How Open and Start-session are carried out (AC13). The setting stores what the person chose;
 * this says what actually happens, given whether the server has a terminal launcher switched on.
 *
 *   auto      the terminal when the server has a launcher, the desktop app when it does not (the default)
 *   app       hand it to the tool's desktop app through its URL scheme
 *   copy      put the terminal command on the clipboard, to paste into any terminal
 *   terminal  have the server open it in the terminal it was started for (`MOON_BASE_TERMINAL`)
 *
 * `auto` exists because "the person has not chosen yet" cannot be read back from browser storage: it is
 * kept per origin (the port is part of it), and every settings write stores the whole object. A value
 * that means "not chosen" can.
 *
 * Split out of `main.js` so it can be tested without the scene.
 */
export const OPEN_MODES = ['auto', 'app', 'copy', 'terminal']

/**
 * `terminal` needs a launcher, and a stored choice outlives the server that had one, so it falls back
 * to `copy` rather than to a button that answers with an error. Anything unrecognised is `app`, so an
 * old or hand-edited setting can never leave Open with no meaning.
 */
export function resolveOpenMode(setting, launcher) {
  const hasLauncher = Boolean(launcher && typeof launcher.id === 'string' && launcher.id)
  if (setting === 'auto') return hasLauncher ? 'terminal' : 'app'
  if (setting === 'copy') return 'copy'
  if (setting === 'terminal') return hasLauncher ? 'terminal' : 'copy'
  return 'app'
}

/**
 * What the person is told after a terminal launch. A session cmux reports as open is "already open in"
 * that terminal. One that only Claude's own record shows running (`via: 'claude'`, the case when cmux's
 * integration is off) is "already running", with no terminal named: that record cannot say which holds it.
 */
export function launchNote(result, label) {
  if (!result?.already) return `Opened in ${label}`
  return result.via === 'claude' ? 'Already running: Claude Code has that session open' : `Already open in ${label}`
}
