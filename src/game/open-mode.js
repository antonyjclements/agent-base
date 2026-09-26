/**
 * How Open and Start-session are carried out (AC13). The setting stores what the person chose;
 * this says what actually happens, given whether the server has a terminal launcher switched on.
 *
 *   app       hand it to the tool's desktop app through its URL scheme (the default)
 *   copy      put the terminal command on the clipboard, to paste into any terminal
 *   terminal  have the server open it in the terminal it was started for (`MOON_BASE_TERMINAL`)
 *
 * Split out of `main.js` so it can be tested without the scene.
 */
export const OPEN_MODES = ['app', 'copy', 'terminal']

/**
 * `terminal` needs a launcher, and a stored choice outlives the server that had one, so it falls back
 * to `copy` rather than to a button that answers with an error. Anything unrecognised is `app`, so an
 * old or hand-edited setting can never leave Open with no meaning.
 */
export function resolveOpenMode(setting, launcher) {
  if (setting === 'copy') return 'copy'
  if (setting === 'terminal') return launcher && typeof launcher.id === 'string' && launcher.id ? 'terminal' : 'copy'
  return 'app'
}
