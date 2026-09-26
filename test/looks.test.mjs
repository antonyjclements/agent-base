/**
 * AC9: the bot's design is Moon Base's own. Nothing here can say what is beautiful, but it can rule out
 * the two ways a look could quietly be somebody else's: upstream's white astronaut with a round helmet
 * and round side discs, and upstream's white suit paint.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_LOOK, LOOKS, pickLook, suitFor } from '../src/agents/looks.js'

// Upstream's suit paint, and the ear style of its helmet. Nothing we ship may match either.
const UPSTREAM_WHITES = [0xf3f1ec, 0xe8e4dc, 0xf7f4ee, 0xdfe4e8, 0xf1e9df]
const EARS = ['lamps', 'dish', 'none']

test('a look is chosen by name, and anything else gets the default', () => {
  assert.equal(pickLook(''), DEFAULT_LOOK)
  assert.equal(pickLook('?look=dish'), 'dish')
  assert.equal(pickLook('?a=1&look=lantern'), 'lantern')
  for (const bad of ['?look=nope', '?look=', '?look=__proto__', '?look=constructor', '?look=sphere', '?look=rover%00']) {
    assert.equal(pickLook(bad), DEFAULT_LOOK, bad)
  }
  assert.ok(Object.hasOwn(LOOKS, DEFAULT_LOOK))
})

test('every look is complete and within the ranges the renderer is tuned for', () => {
  const names = new Set()
  for (const [id, look] of Object.entries(LOOKS)) {
    assert.match(id, /^[a-z]+$/)
    assert.ok(look.name && look.blurb, id)
    names.add(look.name)
    assert.ok(look.head.boxiness >= 2 && look.head.boxiness <= 6, `${id} boxiness`)
    assert.equal(look.head.scale.length, 3)
    for (const s of look.head.scale) assert.ok(s >= 0.7 && s <= 1.3, `${id} scale`)
    assert.ok(EARS.includes(look.ears), `${id} ears`)
    assert.ok(look.antenna === null || (look.antenna.height > 0 && look.antenna.height <= 1.2), `${id} antenna`)
    assert.equal(look.suit.length, 5, `${id} suit tones`)
    for (const tone of look.suit) assert.ok(Number.isInteger(tone) && tone >= 0 && tone <= 0xffffff, `${id} tone`)
  }
  assert.equal(names.size, Object.keys(LOOKS).length, 'names are unique')
})

test('no shipped look is a round helmet, round side discs, or upstream’s white paint', () => {
  for (const [id, look] of Object.entries(LOOKS)) {
    const isSphere = look.head.boxiness === 2 && look.head.scale.every((s) => s === 1)
    assert.equal(isSphere, false, `${id} has a plain spherical head`)
    assert.notEqual(look.ears, 'discs', `${id} uses upstream's ear discs`)
    for (const tone of look.suit) assert.equal(UPSTREAM_WHITES.includes(tone), false, `${id} reuses an upstream suit tone`)
  }
})

test('the looks differ from one another in silhouette, not just in paint', () => {
  const shapes = Object.values(LOOKS).map((l) => JSON.stringify([l.head, l.ears, l.antenna]))
  assert.equal(new Set(shapes).size, shapes.length)
  const ears = new Set(Object.values(LOOKS).map((l) => l.ears))
  assert.ok(ears.size >= 3, 'each has its own fittings')
})

const rgb = (t) => [(t >> 16) & 255, (t >> 8) & 255, t & 255]
const meanColour = (tones) => [0, 1, 2].map((i) => tones.reduce((s, t) => s + rgb(t)[i], 0) / tones.length)

test('every look has a second palette for Codex that is visibly different from the first', () => {
  for (const [id, look] of Object.entries(LOOKS)) {
    assert.equal(look.suitCodex.length, 5, `${id} codex tones`)
    for (const tone of look.suitCodex) {
      assert.ok(Number.isInteger(tone) && tone >= 0 && tone <= 0xffffff, `${id} tone`)
      assert.equal(UPSTREAM_WHITES.includes(tone), false, `${id} reuses an upstream white`)
      assert.equal(look.suit.includes(tone), false, `${id} shares a tone between the two tools`)
    }
    const [a, b] = [meanColour(look.suit), meanColour(look.suitCodex)]
    const apart = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    assert.ok(apart > 40, `${id}: the palettes are only ${apart.toFixed(0)} apart, too close to tell at a glance`)
  }
})

test('a bot is painted from its own tool’s palette, the same way every time', () => {
  for (const [id, look] of Object.entries(LOOKS)) {
    const seen = { claude: new Set(), codex: new Set() }
    for (let index = 0; index < 20; index++) {
      const claude = suitFor(look, 'claude-code', index)
      const codex = suitFor(look, 'codex', index)
      assert.ok(look.suit.includes(claude), `${id} claude`)
      assert.ok(look.suitCodex.includes(codex), `${id} codex`)
      assert.equal(suitFor(look, 'codex', index), codex, 'deterministic')
      seen.claude.add(claude)
      seen.codex.add(codex)
      // Anything unknown is treated as the first tool rather than left unpainted.
      assert.ok(look.suit.includes(suitFor(look, undefined, index)))
      assert.ok(look.suit.includes(suitFor(look, 'somebody-else', index)))
    }
    assert.equal(seen.claude.size, look.suit.length, `${id} uses every tone`)
    assert.equal(seen.codex.size, look.suitCodex.length, `${id} uses every tone`)
  }
})
