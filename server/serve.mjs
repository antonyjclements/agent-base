import http from 'node:http'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiMiddleware } from './api.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(here, '..', 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** Resolve inside `dist` only — a request can never climb out with `..`. Null when it would, or cannot be decoded. */
function resolveInDist(dist, pathname) {
  let rel
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '')
  } catch {
    return null // a stray `%` is not a path, and must not be an exception in a server that stays up
  }
  const file = path.resolve(dist, rel || 'index.html')
  return file === dist || file.startsWith(dist + path.sep) ? file : null
}

const respond = (dist) => async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname.startsWith('/api/')) {
    return apiMiddleware(req, res, null)
  }

  let file = resolveInDist(dist, url.pathname)
  if (!file) {
    res.writeHead(403).end('Forbidden')
    return
  }
  try {
    if ((await fsp.stat(file)).isDirectory()) file = path.join(file, 'index.html')
  } catch {
    file = path.join(dist, 'index.html') // SPA fallback
  }

  try {
    const body = await fsp.readFile(file)
    const type = TYPES[path.extname(file)] || 'application/octet-stream'
    const cache = file.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': cache })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
  }
}

/**
 * Nothing may throw out of a request handler. It is async, so a throw is an unhandled rejection, and that ends
 * the process: one request line that is not a valid address (`GET http://[ HTTP/1.1`, which makes `new URL` throw)
 * would stop a Moon Base that was meant to stay up. A bad address is a 400, and anything else unforeseen is a 500.
 */
const handler = (dist) => {
  const answer = respond(dist)
  return async (req, res) => {
    try {
      await answer(req, res)
    } catch (err) {
      if (res.headersSent) return void res.destroy()
      const bad = err?.code === 'ERR_INVALID_URL'
      res.writeHead(bad ? 400 : 500, { 'Content-Type': 'text/plain' }).end(bad ? 'Bad Request' : 'Internal Server Error')
    }
  }
}

/**
 * Start the production server: the built page out of `dist/`, and the API. Resolves with a handle once it
 * is listening, and rejects with the listen error (an in-use port is `EADDRINUSE`) so a caller can turn it
 * into a message. `port` 0 asks the system for a free one; the handle says which it got.
 */
export function serve({ port = Number(process.env.PORT) || 5274, host = process.env.MOON_BASE_HOST || '127.0.0.1', dist = DIST } = {}) {
  const root = path.resolve(dist)
  const server = http.createServer(handler(root))
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve({ server, port: server.address().port, host, close: () => new Promise((done) => server.close(done)) })
    })
  })
}

// `node server/serve.mjs` (and `npm start`) still start it, exactly as before.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serve()
    .then(({ host, port }) => console.log(`Moon Base → http://${host}:${port}`))
    .catch((err) => {
      console.error(`Could not start: ${err.message}`)
      process.exit(1)
    })
}
