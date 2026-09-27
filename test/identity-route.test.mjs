/**
 * AC15, how `moonbase1` tells a running Moon Base from anything else on a port: a read-only
 * `GET /api/identity`. It says what it is and nothing about the machine, and it is refused to anyone
 * who is not the page itself, like every other route.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'

import { withServer } from './support/with-server.mjs'
import { probePort } from '../cli/port.mjs'

async function withLauncher(value, fn) {
  const before = process.env.MOON_BASE_TERMINAL
  if (value === undefined) delete process.env.MOON_BASE_TERMINAL
  else process.env.MOON_BASE_TERMINAL = value
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env.MOON_BASE_TERMINAL
    else process.env.MOON_BASE_TERMINAL = before
  }
}

test('it says it is Moon Base, which version and process, and whether the launcher is on', async () => {
  await withLauncher(undefined, () =>
    withServer(async ({ call }) => {
      const res = await call('/api/identity')
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.deepEqual(Object.keys(body).sort(), ['app', 'launcher', 'pid', 'version'])
      assert.equal(body.app, 'moon-base')
      assert.match(body.version, /^\d+\.\d+\.\d+/)
      assert.equal(body.pid, process.pid)
      assert.equal(body.launcher, null)
    })
  )
  await withLauncher('cmux', () =>
    withServer(async ({ call }) => {
      assert.deepEqual((await (await call('/api/identity')).json()).launcher, { id: 'cmux', label: 'cmux' })
    })
  )
})

test('it tells nothing about the machine: no path, no environment', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ call }) => {
      const text = await (await call('/api/identity')).text()
      assert.ok(!text.includes(os.homedir()), 'no home path')
      assert.ok(!text.includes(process.cwd()), 'no working folder')
      assert.ok(!/MOON_BASE|PATH=|HOME/.test(text), 'no environment')
    })
  )
})

test('only a GET is an identity request, and only from the page itself', async () => {
  await withServer(async ({ call, port }) => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      assert.equal((await call('/api/identity', { method })).status, 404, method)
    }
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/identity', headers: { Host: 'evil.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode)
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 403, 'a foreign Host is refused')
  })
})

test('the start command recognises a running copy by it, and sees a stopped one as free', async () => {
  let port
  await withServer(async (ctx) => {
    port = ctx.port
    const seen = await probePort(port)
    assert.equal(seen.kind, 'moon-base')
    assert.equal(seen.identity.app, 'moon-base')
  })
  assert.equal((await probePort(port)).kind, 'free', 'the server is closed now, and nothing is listening')
})

test('a request line that is not a valid address is a 400 from the API, not an unhandled rejection', async () => {
  const rejections = []
  const onRejection = (e) => rejections.push(e)
  process.on('unhandledRejection', onRejection)
  try {
    await withServer(async ({ port }) => {
      for (const line of ['GET http://[ HTTP/1.1', 'GET http://:80 HTTP/1.1']) {
        const status = await new Promise((resolve) => {
          const c = net.connect(port, '127.0.0.1', () => c.write(`${line}\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`))
          let out = ''
          c.on('data', (d) => (out += d))
          c.on('close', () => resolve(out.split('\r\n')[0] || '(closed with no answer)'))
          setTimeout(() => (c.destroy(), resolve('(no answer)')), 2000).unref()
        })
        assert.match(status, /^HTTP\/1\.1 400\b/, `${line} -> ${status}`)
      }
    })
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(rejections.map((e) => e?.message), [])
  } finally {
    process.off('unhandledRejection', onRejection)
  }
})
