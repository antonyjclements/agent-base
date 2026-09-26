/**
 * AC13, the page's half: which way Open and Start-session go, given the setting and whether the
 * server says a terminal launcher is on. Kept in a module of its own so it needs no scene or DOM.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { OPEN_MODES, resolveOpenMode } from '../src/game/open-mode.js'
import { Settings } from '../src/core/settings.js'

const CMUX = { id: 'cmux', label: 'cmux' }

test('the three ways to open are the desktop app, a copied command and a terminal', () => {
  assert.deepEqual([...OPEN_MODES], ['app', 'copy', 'terminal'])
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

test('a fresh install opens in the desktop app, as before', () => {
  assert.equal(new Settings().get('openWith'), 'app')
})
