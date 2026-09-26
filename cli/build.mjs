/**
 * Being fast: serve the build that is there, and make one only when there is none or the source has moved
 * on since. The check is modification times against `dist/index.html`, over a fixed set of what goes into
 * the page. Dotfiles are skipped (a Finder's `.DS_Store` must not force a rebuild), and so is everything
 * that is not the page: the server, the tests, the docs, the data, `node_modules` and `dist` itself.
 */
import { spawnSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'

/** Relative to the project folder. */
const SOURCES = ['src', 'public', 'index.html', 'vite.config.js', 'package.json']

async function newest(entry) {
  let stat
  try {
    stat = await fsp.stat(entry)
  } catch {
    return 0 // not there is not newer
  }
  if (!stat.isDirectory()) return stat.mtimeMs
  let at = 0
  for (const name of await fsp.readdir(entry)) {
    if (name.startsWith('.')) continue
    at = Math.max(at, await newest(path.join(entry, name)))
  }
  return at
}

/** `{ state: 'missing' | 'stale' | 'fresh', distAt, sourceAt }`. Equal times are fresh. */
export async function buildState({ root }) {
  let distAt = 0
  try {
    distAt = (await fsp.stat(path.join(root, 'dist', 'index.html'))).mtimeMs
  } catch {
    return { state: 'missing', distAt: 0, sourceAt: 0 }
  }
  let sourceAt = 0
  for (const entry of SOURCES) sourceAt = Math.max(sourceAt, await newest(path.join(root, entry)))
  return { state: sourceAt > distAt ? 'stale' : 'fresh', distAt, sourceAt }
}

/**
 * Make the build: the asset step, then Vite, each with this Node in the project folder and speaking for
 * itself, so a failure shows its own output. It needs neither `npm` nor a PATH. The first step that fails
 * is the answer, and Vite is not run after it.
 */
export async function runBuild({ root, spawn = spawnSync, err = console.error }) {
  const vite = path.join('node_modules', 'vite', 'bin', 'vite.js')
  try {
    await fsp.access(path.join(root, vite))
  } catch {
    err('Vite is not installed here, so the page cannot be built. Run `npm install` in the Moon Base folder first.')
    return 1
  }
  for (const args of [['tools/build-assets.mjs'], [vite, 'build']]) {
    let result
    try {
      result = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' })
    } catch {
      return 1
    }
    if (result.error || result.status !== 0) return result.status || 1
  }
  return 0
}
