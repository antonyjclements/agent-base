/**
 * Packs every source pack the colony needs into the four glbs it loads.
 *
 * The raw packs are not checked in and the built glbs are, so this is a no-op on a fresh
 * clone — it only has work to do when a pack has been re-downloaded into `assets-src/` or
 * one of the lists below has changed.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { packDir } from './pack-dir.mjs'

/**
 * Which of the Forest Nature Pack's 105 models to keep.
 *
 * The pack ships every model in several sizes and colour variants; the colony wants a
 * handful of silhouettes and gets its variety from per-instance scale and rotation instead,
 * so packing the lot would be five times the file for no more to look at.
 */
const FOREST = [
  // Canopies: round, flat-top and fir, each in a common size, plus a rarer large one.
  'Tree_1_A', 'Tree_3_A', 'Tree_4_A', 'Tree_1_C', 'Tree_3_C', 'Tree_4_C',
  'Bush_1_E', 'Bush_3_B',
  'Grass_2_D',
  // Boulders. Painted neutral grey, which is what lets them be tinted per planet.
  'Rock_1_D', 'Rock_2_C', 'Rock_3_E', 'Rock_1_J', 'Rock_2_G', 'Rock_3_L', 'Rock_3_Q',
].map((n) => `${n}_Color1`)

const space = packDir('KayKit_Space_Base_Bits')
const forest = packDir('KayKit_Forest_Nature_Pack')
// The extra tier of the forest pack sorts its eight colour variants into folders; the free tier has
// only the first, flat. The colony uses the first either way.
const forestModels = forest && (existsSync(join(forest, 'Assets/gltf/Color1')) ? join(forest, 'Assets/gltf/Color1') : join(forest, 'Assets/gltf'))

const STEPS = [
  ['tools/build-kit.mjs', space ? join(space, 'Assets/gltf') : 'assets-src/KayKit_Space_Base_Bits/Assets/gltf', 'public/assets/spacebase.glb'],
  ['tools/build-kit.mjs', forestModels || 'assets-src/KayKit_Forest_Nature_Pack/Assets/gltf', 'public/assets/forest.glb', FOREST.join(',')],
  // Kenney's Nature Kit has its own packer: its models are flat-colour primitives rather
  // than atlas-mapped, and the packer bakes those colours into vertices. The list of what
  // is kept, and the recolours that turn an oak into a cherry tree, live in there.
  ['tools/build-nature.mjs', 'assets-src/kenney_nature-kit/Models/GLTF format', 'public/assets/nature.glb'],
  // The bot: KayKit's mannequin and the clips the colony plays, composed into one rigged file.
  ['tools/build-bot.mjs'],
]

for (const [script, ...args] of STEPS) {
  const run = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' })
  if (run.status !== 0) process.exit(run.status ?? 1)
}
