/**
 * AC15, opening the page: a fixed program with the address as its one argument, on the platforms that have
 * one, and never a failure. It is the command line opening a page for the person who ran it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { openPage } from '../cli/open-page.mjs'

function fake({ throws = false } = {}) {
  const calls = []
  const child = { handlers: {}, unrefd: false, on(event, fn) { this.handlers[event] = fn }, unref() { this.unrefd = true } }
  const spawn = (cmd, args, opts) => {
    if (throws) throw new Error('spawn failed')
    calls.push({ cmd, args, opts })
    return child
  }
  return { calls, child, spawn }
}

test('macOS uses open and Linux uses xdg-open, with the address as the one argument', () => {
  for (const [platform, program] of [['darwin', 'open'], ['linux', 'xdg-open']]) {
    const f = fake()
    assert.equal(openPage('http://127.0.0.1:5274', { platform, spawn: f.spawn }), true, platform)
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].cmd, program)
    assert.deepEqual(f.calls[0].args, ['http://127.0.0.1:5274'])
  }
})

test('it is detached from this process and says nothing, so the command line is not held up by the browser', () => {
  const f = fake()
  openPage('http://127.0.0.1:5274', { platform: 'darwin', spawn: f.spawn })
  assert.equal(f.calls[0].opts.stdio, 'ignore')
  assert.equal(f.calls[0].opts.detached, true)
  assert.ok(!f.calls[0].opts.shell, 'no shell')
  assert.equal(f.child.unrefd, true)
})

test('an address is one argument however odd it is, never something a shell could split', () => {
  const f = fake()
  const odd = 'http://host name;touch x:5274/$(id)'
  openPage(odd, { platform: 'darwin', spawn: f.spawn })
  assert.deepEqual(f.calls[0].args, [odd])
})

test('a platform with no opener gets false and nothing is started', () => {
  for (const platform of ['win32', 'freebsd', 'aix', 'sunos', '']) {
    const f = fake()
    assert.equal(openPage('http://127.0.0.1:5274', { platform, spawn: f.spawn }), false, String(platform))
    assert.equal(f.calls.length, 0)
  }
})

test('an opener that cannot start, or that fails later, is not an error', () => {
  assert.equal(openPage('http://127.0.0.1:5274', { platform: 'darwin', spawn: fake({ throws: true }).spawn }), false)
  const f = fake()
  openPage('http://127.0.0.1:5274', { platform: 'darwin', spawn: f.spawn })
  assert.doesNotThrow(() => f.child.handlers.error(new Error('ENOENT')), 'an `error` event on the child is swallowed')
})
