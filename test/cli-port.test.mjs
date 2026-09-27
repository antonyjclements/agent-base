/**
 * AC15, choosing a port: who is on each one, and which to use. A running Moon Base is reused wherever it
 * is in the range, even past a free port; anything else is skipped; the first free port is used.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_PORT, PORT_SPAN, pickPort, probePort, urlHost } from '../cli/port.mjs'

const json = (body, init = {}) => ({ ok: true, status: 200, json: async () => body, ...init })
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

test('the default port is 5274 and the search reaches twenty past it', () => {
  assert.equal(DEFAULT_PORT, 5274)
  assert.equal(PORT_SPAN, 20)
})

test('a host goes into a URL as the address the server is on: IPv6 in brackets, "every address" as loopback', () => {
  assert.equal(urlHost('127.0.0.1'), '127.0.0.1')
  assert.equal(urlHost('localhost'), 'localhost')
  assert.equal(urlHost('10.9.8.7'), '10.9.8.7')
  assert.equal(urlHost('::1'), '[::1]')
  assert.equal(urlHost('fe80::1'), '[fe80::1]')
  assert.equal(urlHost('0.0.0.0'), '127.0.0.1')
  assert.equal(urlHost('::'), '127.0.0.1')
})

test('a port answers as Moon Base, as free, or as something else', async () => {
  const seen = []
  const asks = (fetchImpl) => probePort(5300, { fetchImpl: async (url, opts) => (seen.push([url, opts]), fetchImpl()) })

  const identity = { app: 'moon-base', version: '0.1.0', pid: 1, launcher: null }
  assert.deepEqual(await asks(() => json(identity)), { kind: 'moon-base', identity })
  assert.equal(seen[0][0], 'http://127.0.0.1:5300/api/identity')
  assert.ok(seen[0][1].signal, 'a hung port cannot hold the start up')

  assert.deepEqual(await asks(() => { throw refused() }), { kind: 'free' })
  for (const other of [
    () => json({ app: 'something-else' }),
    () => json(null),
    () => json({ app: 'moon-base' }, { ok: false, status: 500 }),
    () => json(undefined, { json: async () => { throw new SyntaxError('not json') } }),
    () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }) },
    () => { throw new TypeError('fetch failed') },
  ]) {
    assert.deepEqual(await asks(other), { kind: 'other' })
  }
})

const map = (o) => async (port) => o[port] ?? { kind: 'other' }
const identity = { app: 'moon-base', launcher: null }

test('the first free port is used', async () => {
  assert.deepEqual(await pickPort({ base: 5274, probe: map({ 5274: { kind: 'free' } }) }), { kind: 'free', port: 5274 })
  assert.deepEqual(await pickPort({ base: 5274, probe: map({ 5274: { kind: 'other' }, 5275: { kind: 'other' }, 5276: { kind: 'free' }, 5277: { kind: 'free' } }) }), { kind: 'free', port: 5276 })
})

test('a running Moon Base is reused, even past a free port, so a second copy is never started', async () => {
  const probe = map({ 5274: { kind: 'free' }, 5276: { kind: 'moon-base', identity } })
  assert.deepEqual(await pickPort({ base: 5274, probe }), { kind: 'reuse', port: 5276, identity })
})

test('with two running copies the lower port wins', async () => {
  const probe = map({ 5275: { kind: 'moon-base', identity: { ...identity, pid: 1 } }, 5279: { kind: 'moon-base', identity: { ...identity, pid: 2 } } })
  assert.equal((await pickPort({ base: 5274, probe })).port, 5275)
})

test('the search covers the base and twenty after it, and no more', async () => {
  const asked = []
  const probe = async (p) => (asked.push(p), { kind: 'other' })
  assert.deepEqual(await pickPort({ base: 6000, probe }), { kind: 'none' })
  assert.deepEqual(asked.sort((a, b) => a - b), Array.from({ length: 21 }, (_, i) => 6000 + i))
  assert.deepEqual(await pickPort({ base: 6000, probe: map({ 6021: { kind: 'free' } }) }), { kind: 'none' }, 'one past the range is not looked at')
})

test('a base near the top of the range does not run off the end of the ports', async () => {
  const asked = []
  await pickPort({ base: 65530, probe: async (p) => (asked.push(p), { kind: 'other' }) })
  assert.ok(asked.every((p) => p <= 65535))
})
