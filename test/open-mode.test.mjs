/**
 * AC13, the page's half: which way Open and Start-session go, given the setting and whether the
 * server says a terminal launcher is on. Kept in a module of its own so it needs no scene or DOM.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { OPEN_MODES, launchNote, resolveOpenMode } from '../src/game/open-mode.js'
import { Settings } from '../src/core/settings.js'

const CMUX = { id: 'cmux', label: 'cmux' }

test('the ways to open are automatic, the desktop app, a copied command and a terminal', () => {
  assert.deepEqual([...OPEN_MODES], ['auto', 'app', 'copy', 'terminal'])
})

test('automatic is the terminal where the server has a launcher, and the desktop app where it does not', () => {
  assert.equal(resolveOpenMode('auto', CMUX), 'terminal')
  for (const launcher of [null, undefined, false, {}, { id: '' }]) {
    assert.equal(resolveOpenMode('auto', launcher), 'app', JSON.stringify(launcher))
  }
})

test('what is chosen is what happens, when it can', () => {
  assert.equal(resolveOpenMode('app', null), 'app')
  assert.equal(resolveOpenMode('app', CMUX), 'app')
  assert.equal(resolveOpenMode('copy', null), 'copy')
  assert.equal(resolveOpenMode('copy', CMUX), 'copy')
  assert.equal(resolveOpenMode('terminal', CMUX), 'terminal')
})

test('a stored terminal choice falls back to copying when the launcher is off', () => {
  for (const launcher of [null, undefined, false, {}, { id: '' }]) {
    assert.equal(resolveOpenMode('terminal', launcher), 'copy', JSON.stringify(launcher))
  }
})

test('anything else is the default, so a bad or old setting never blocks Open', () => {
  for (const value of [undefined, null, '', 'App', 'cmux', 'sh', 5, {}, ['copy']]) {
    assert.equal(resolveOpenMode(value, CMUX), 'app', JSON.stringify(value))
  }
})

test('a fresh install is automatic, so the first click inside cmux already works', () => {
  assert.equal(new Settings().get('openWith'), 'auto')
})

test('a choice already stored is kept, and an install that never chose is automatic', () => {
  const store = (value) => {
    globalThis.localStorage = { getItem: () => JSON.stringify(value), setItem() {} }
  }
  try {
    for (const chosen of ['app', 'copy', 'terminal']) {
      store({ openWith: chosen })
      assert.equal(new Settings().get('openWith'), chosen)
    }
    store({ preset: 'high' }) // stored before this setting existed
    assert.equal(new Settings().get('openWith'), 'auto')
  } finally {
    delete globalThis.localStorage
  }
})

test('what the page tells the person after a terminal launch says which check answered', () => {
  assert.equal(launchNote({ ok: true }, 'cmux'), 'Opened in cmux')
  assert.equal(launchNote({ ok: true, already: true }, 'cmux'), 'Already open in cmux')
  assert.equal(
    launchNote({ ok: true, already: true, via: 'claude' }, 'cmux'),
    'Already running: Claude Code has that session open',
    'the marker cannot say which terminal holds it, so it does not name one'
  )
  assert.equal(launchNote({ ok: true, already: true, via: 'something-new' }, 'cmux'), 'Already open in cmux', 'an unknown source reads as the usual answer')
  assert.equal(launchNote({ ok: true, via: 'claude' }, 'cmux'), 'Opened in cmux', 'via only means something when it was already open')
})
