/**
 * How a Moon Base bot looks.
 *
 * Every look shares the same skeleton and motion (KayKit's mannequin and animations, both CC0). What
 * differs is the head's silhouette, what is bolted to it, and the paint. The head is a sphere pushed
 * toward a box (`boxiness`: 2 is a sphere, higher is squarer) and then stretched (`scale`), which is
 * the difference between a spacesuit helmet and a machine's head.
 *
 * Pick one for a session with `?look=rover|lantern|dish`. Suit tones are multiplied into the parts'
 * own colours, so they are kept light enough that the panels still read.
 *
 * Two palettes tell the tools apart at a glance: `suit` paints Claude Code's bots and `suitCodex` paints
 * Codex's. The state colours (trim and eyes) are left alone, because those already mean something.
 */
export const LOOKS = {
  rover: {
    name: 'Rover',
    blurb: 'A squat survey bot: a wide, low camera-housing head with a lamp on each side, in warm regolith sand.',
    head: { boxiness: 4.2, scale: [1.14, 0.84, 1.0] },
    ears: 'lamps',
    antenna: { height: 0.4 },
    suit: [0xe2cfa8, 0xd8c39a, 0xe8d8b5, 0xd0bc94, 0xdcc8a0],
    suitCodex: [0xa9bccf, 0x9db2c7, 0xb4c6d8, 0x95abc0, 0xa2b6ca],
  },
  lantern: {
    name: 'Lantern',
    blurb: 'A tall, narrow head like a lantern on a stalk, with a long mast and no side fittings, in cool slate.',
    head: { boxiness: 2.5, scale: [0.9, 1.18, 0.94] },
    ears: 'none',
    antenna: { height: 0.9 },
    suit: [0xaab3c0, 0x9ea8b6, 0xb4bcc8, 0x96a0ae, 0xa5aebb],
    suitCodex: [0xcfa78f, 0xc49b83, 0xd8b39c, 0xbb917a, 0xcaa189],
  },
  dish: {
    name: 'Dish',
    blurb: 'A rounded-square head with a small radar dish on one side and no mast, in pale lunar blue-grey.',
    head: { boxiness: 3.2, scale: [1.0, 0.96, 1.04] },
    ears: 'dish',
    antenna: null,
    suit: [0xd5dde6, 0xcbd4de, 0xdde4ec, 0xc4cdd8, 0xd0d8e2],
    suitCodex: [0xe3b5aa, 0xdba89c, 0xebc2b8, 0xd49f93, 0xdfaea2],
  },
}

export const DEFAULT_LOOK = 'rover'

/** The look named in a query string, or the default when it names nothing we have. */
export function pickLook(search = '') {
  const id = new URLSearchParams(search).get('look')
  return Object.hasOwn(LOOKS, id) ? id : DEFAULT_LOOK
}

/**
 * The paint for one bot: the look's first palette for Claude Code (and for anything unknown), its
 * second for Codex. `index` picks a tone within the palette, so neighbours differ slightly.
 */
export function suitFor(look, harness, index) {
  const tones = harness === 'codex' && look.suitCodex ? look.suitCodex : look.suit
  return tones[index % tones.length]
}
