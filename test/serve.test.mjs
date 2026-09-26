/**
 * AC15, the production server as a function: `serve()` starts it, hands back a handle, and says why it
 * could not (an in-use port is an error the start command can turn into a message, not a crash). What it
 * serves is unchanged: files out of `dist/` only, a fallback to `index.html`, and `/api` to the API.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { serve } from '../server/serve.mjs'

const ROOT = new URL('..', import.meta.url).pathname

async function withDist(fn) {
  const dist = await fsp.mkdtemp(path.join(os.tmpdir(), 'dist-'))
  await fsp.mkdir(path.join(dist, 'assets'))
  await fsp.writeFile(path.join(dist, 'index.html'), '<title>fixture</title>')
  await fsp.writeFile(path.join(dist, 'assets', 'app.js'), 'console.log(1)')
  const secret = path.join(path.dirname(dist), `${path.basename(dist)}-secret.txt`)
  await fsp.writeFile(secret, 'not for you')
  try {
    return await fn(dist)
  } finally {
    await fsp.rm(dist, { recursive: true, force: true })
    await fsp.rm(secret, { force: true })
  }
}

/** Fail after `ms` instead of waiting forever: a server that never answers is a failing test, not a hung one. */
const within = (ms, promise, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms`)), ms).unref())])

/** A raw GET, so a path is sent exactly as written (fetch would tidy `..` away). */
const rawGet = (port, rawPath, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, headers, timeout: 3000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('timeout', () => req.destroy(new Error(`GET ${rawPath} did not answer`)))
    req.on('error', reject)
    req.end()
  })

test('serve() starts on the port it is given, and closes', async () => {
  await withDist(async (dist) => {
    const s = await serve({ port: 0, host: '127.0.0.1', dist })
    assert.ok(s.port > 0)
    assert.equal(s.host, '127.0.0.1')
    const res = await fetch(`http://127.0.0.1:${s.port}/`)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /fixture/)
    await s.close()
    await assert.rejects(fetch(`http://127.0.0.1:${s.port}/`))
  })
})

test('files come out of dist, assets are cached for good, and an unknown path falls back to the page', async () => {
  await withDist(async (dist) => {
    const s = await serve({ port: 0, host: '127.0.0.1', dist })
    try {
      const asset = await rawGet(s.port, '/assets/app.js')
      assert.equal(asset.status, 200)
      assert.match(asset.headers['content-type'], /javascript/)
      assert.match(asset.headers['cache-control'], /immutable/)
      const page = await rawGet(s.port, '/some/route')
      assert.equal(page.status, 200)
      assert.match(page.body, /fixture/)
      assert.equal(page.headers['cache-control'], 'no-cache')
    } finally {
      await s.close()
    }
  })
})

test('a request can never climb out of dist', async () => {
  await withDist(async (dist) => {
    const s = await serve({ port: 0, host: '127.0.0.1', dist })
    try {
      const secret = `${path.basename(dist)}-secret.txt`
      for (const p of [`/..%2f${secret}`, `/%2e%2e%2f${secret}`, `/assets/..%2f..%2f${secret}`, '/..%2f..%2f..%2fetc%2fpasswd']) {
        const res = await rawGet(s.port, p)
        assert.equal(res.status, 403, p)
        assert.ok(!res.body.includes('not for you'), p)
      }
    } finally {
      await s.close()
    }
  })
})

test('a path that is not valid text is refused, and the server carries on', async () => {
  await withDist(async (dist) => {
    const s = await serve({ port: 0, host: '127.0.0.1', dist })
    try {
      for (const p of ['/%E0%A4%A', '/%', '/%zz', '/assets/%ff%fe']) {
        const res = await rawGet(s.port, p)
        assert.ok([200, 403, 404].includes(res.status), `${p} -> ${res.status}`)
      }
      assert.equal((await rawGet(s.port, '/')).status, 200, 'still up afterwards')
    } finally {
      await s.close()
    }
  })
})

/** A request line sent exactly as written over a raw socket, and the status line that came back. */
const rawLine = (port, line) =>
  new Promise((resolve) => {
    const c = net.connect(port, '127.0.0.1', () => c.write(`${line}\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`))
    let out = ''
    c.on('data', (d) => (out += d))
    c.on('close', () => resolve(out.split('\r\n')[0] || '(closed with no answer)'))
    setTimeout(() => (c.destroy(), resolve('(no answer)')), 2000).unref()
  })

test('a request line that is not a valid address is refused, and the server carries on', async () => {
  const rejections = []
  const onRejection = (e) => rejections.push(e)
  process.on('unhandledRejection', onRejection)
  try {
    await withDist(async (dist) => {
      const s = await serve({ port: 0, host: '127.0.0.1', dist })
      try {
        for (const line of ['GET http://[ HTTP/1.1', 'GET //%zz HTTP/1.1', 'GET http://:80 HTTP/1.1', 'GET http://a%zz/ HTTP/1.1']) {
          const status = await rawLine(s.port, line)
          assert.match(status, /^HTTP\/1\.1 (400|404)\b/, `${line} -> ${status}`)
        }
        assert.equal((await rawGet(s.port, '/')).status, 200, 'still up afterwards')
      } finally {
        await s.close()
      }
    })
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(rejections.map((e) => e?.message), [], 'nothing was left unhandled')
  } finally {
    process.off('unhandledRejection', onRejection)
  }
})

test('/api goes to the API, which still refuses a request that is not from its own page', async () => {
  await withDist(async (dist) => {
    process.env.MOON_BASE_DATA ??= await fsp.mkdtemp(path.join(os.tmpdir(), 'serve-data-'))
    process.env.MOON_BASE_CMUX_DIR ??= path.join(os.tmpdir(), 'serve-no-cmux')
    const s = await serve({ port: 0, host: '127.0.0.1', dist })
    try {
      assert.equal((await rawGet(s.port, '/api/nope')).status, 404)
      assert.equal((await rawGet(s.port, '/api/nope', { Host: 'evil.example' })).status, 403)
    } finally {
      await s.close()
    }
  })
})

test('a port that is taken is an error the caller can read, not a crash', async () => {
  const taken = net.createServer()
  await new Promise((r) => taken.listen(0, '127.0.0.1', r))
  const { port } = taken.address()
  try {
    await assert.rejects(within(3000, serve({ port, host: '127.0.0.1' }), 'serve()'), (err) => err.code === 'EADDRINUSE')
  } finally {
    await new Promise((r) => taken.close(r))
  }
})

test('run directly, as `npm start` does, it still starts itself and says where', async () => {
  const probe = net.createServer()
  await new Promise((r) => probe.listen(0, '127.0.0.1', r))
  const { port } = probe.address()
  await new Promise((r) => probe.close(r))
  const data = await fsp.mkdtemp(path.join(os.tmpdir(), 'serve-direct-'))
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'serve.mjs')], {
    env: { ...process.env, PORT: String(port), MOON_BASE_DATA: data, MOON_BASE_CMUX_DIR: path.join(data, 'no-cmux') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const line = await new Promise((resolve, reject) => {
      let seen = ''
      const timer = setTimeout(() => reject(new Error(`no start line: ${seen}`)), 8000)
      child.stdout.on('data', (d) => {
        seen += d
        if (/Moon Base → /.test(seen)) {
          clearTimeout(timer)
          resolve(seen)
        }
      })
      child.on('exit', (code) => reject(new Error(`exited ${code}: ${seen}`)))
    })
    assert.match(line, new RegExp(`http://127\\.0\\.0\\.1:${port}`))
  } finally {
    child.removeAllListeners('exit')
    child.kill()
    await fsp.rm(data, { recursive: true, force: true })
  }
})
