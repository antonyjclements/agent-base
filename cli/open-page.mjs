/**
 * Open the page in the default browser, the way the OS does it: `open` on macOS, `xdg-open` on Linux. This
 * is the command line opening a page for the person who just ran it, not the server opening anything, and
 * it is a fixed program with the address as its one argument. Never throws; false when it cannot.
 */
import { spawn as nodeSpawn } from 'node:child_process'

const OPENERS = { darwin: 'open', linux: 'xdg-open' }

export function openPage(url, { platform = process.platform, spawn = nodeSpawn } = {}) {
  const opener = OPENERS[platform]
  if (!opener) return false
  try {
    const child = spawn(opener, [url], { stdio: 'ignore', detached: true })
    child.on?.('error', () => {})
    child.unref?.()
    return true
  } catch {
    return false
  }
}
