/**
 * Choosing a port for `moonbase1`, by asking who is on each one rather than by keeping a lock file, so a
 * copy started any other way (`npm run dev`, a terminal that has since closed) is found too.
 */
export const DEFAULT_PORT = 5274
export const PORT_SPAN = 20

/**
 * Where a server bound to `host` is reached, written as it goes into a URL: the address it is actually on,
 * with an IPv6 literal in brackets. Only "every address" is not a place to go to, so that is loopback.
 * Guessing loopback for everything else pointed a server bound to `::1` at `127.0.0.1`, where nothing listens.
 */
export function urlHost(host) {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host.includes(':') ? `[${host}]` : host
}

/**
 * Who is on `port`: `{ kind: 'moon-base', identity }`, `{ kind: 'free' }` when nothing is listening, or
 * `{ kind: 'other' }` for anything else (another program, a Moon Base that will not answer, a hung port).
 * Bounded, so one hung port cannot hold the start up.
 */
export async function probePort(port, { fetchImpl = fetch, host = '127.0.0.1', timeoutMs = 800 } = {}) {
  try {
    const res = await fetchImpl(`http://${host}:${port}/api/identity`, { signal: AbortSignal.timeout(timeoutMs) })
    const identity = await res.json().catch(() => null)
    if (res.ok && identity && identity.app === 'moon-base') return { kind: 'moon-base', identity }
    return { kind: 'other' }
  } catch (err) {
    return { kind: (err?.cause?.code ?? err?.code) === 'ECONNREFUSED' ? 'free' : 'other' }
  }
}

/**
 * Where to start: a running Moon Base anywhere in the range wins (the lowest port, if there are two), even
 * past a free port, so a second copy is never started beside the first; otherwise the first free port.
 * `{ kind: 'reuse', port, identity }`, `{ kind: 'free', port }` or `{ kind: 'none' }`.
 */
export async function pickPort({ base, span = PORT_SPAN, probe = probePort }) {
  const ports = []
  for (let p = base; p <= base + span && p <= 65535; p++) ports.push(p)
  const seen = await Promise.all(ports.map(async (port) => ({ port, ...(await probe(port)) })))
  const running = seen.find((s) => s.kind === 'moon-base')
  if (running) return { kind: 'reuse', port: running.port, identity: running.identity }
  const free = seen.find((s) => s.kind === 'free')
  return free ? { kind: 'free', port: free.port } : { kind: 'none' }
}
