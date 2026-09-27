import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

/**
 * `call` sets the `Origin` header the same-origin check expects, so a test never trips it by accident.
 *
 * The server's opener is swapped for a recorder: `opened` lists every target it was asked to open,
 * and nothing a test does can start a real app. The terminal launcher is swapped the same way:
 * `launched` lists every argument list it was asked to run, and each one is answered as a success.
 * A test that needs it to fail sets its own with `api.setTerminalRunner`. The cmux "already open"
 * probe defaults to always answering "no" — `api.setSessionProbe` overrides it — so no test ever
 * shells out to a real `cmux`. The Claude marker check that backs it up defaults to "no" too
 * (`api.setRunningProbe`), so no test reads the real `~/.claude/sessions`, which on a developer's machine
 * holds live sessions. `foregrounded` lists every argument list the foreground step was asked to run, and
 * it always succeeds, so no test ever raises a real application either.
 */
export async function withServer(run) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moon-base-test-'))
  process.env.MOON_BASE_DATA = dir
  // No test reads a real `~/.cmuxterm`: unless a test points cmux somewhere itself, it is a folder that is not there.
  process.env.MOON_BASE_CMUX_DIR ??= path.join(dir, 'no-cmux')
  // Imported per-server so DATA_DIR is read fresh; the query string defeats the module cache.
  const api = await import(`../../server/api.mjs?${dir}`)
  const { apiMiddleware } = api
  const opened = []
  api.setOpener((target) => opened.push(target))
  const launched = []
  api.setTerminalRunner(async (argv) => {
    launched.push(argv)
    return { ok: true }
  })
  api.setSessionProbe(async () => ({ open: false }))
  api.setRunningProbe(async () => false)
  const foregrounded = []
  api.setForegrounder(async (argv) => {
    foregrounded.push(argv)
  })
  const server = http.createServer((req, res) => apiMiddleware(req, res, null))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const call = (p, opts) =>
    fetch(`http://127.0.0.1:${port}${p}`, {
      headers: { Origin: `http://localhost:${port}`, 'Content-Type': 'application/json' },
      ...opts,
    })
  try {
    return await run({ api, call, dir, foregrounded, launched, opened, port, put: (b) => call('/api/state', { method: 'PUT', body: JSON.stringify(b) }) })
  } finally {
    server.close()
    await fsp.rm(dir, { recursive: true, force: true })
  }
}
