import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The folder a pack was unpacked into, found by its stable name prefix.
 *
 * KayKit sells each pack in free, extra and source tiers. They unpack to differently named folders
 * (`..._FREE`, `..._EXTRA`, `..._SOURCE`) with the same models inside, so the build looks for the
 * prefix rather than for one tier's full name and works with whichever was downloaded.
 */
export function packDir(prefix, root = 'assets-src') {
  if (!existsSync(root)) return null
  const hit = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
    .map((e) => e.name)
    .sort()[0]
  return hit ? join(root, hit) : null
}
