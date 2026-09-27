// @spec:MB-016
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import { fakeClaude, claudeWith, typed, writeMarker } from './support/fixtures.mjs'
import { LiveStatus } from '../server/hooks/live.mjs'
import { statusFor } from '../src/game/status.js'

const now = Date.now()
const assistant = (content, at = now, stop_reason = 'tool_use') => ({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { content, stop_reason } })
const call = (name, id = 'ask') => ({ type: 'tool_use', id, name, input: {} })
const result = (id, at = now + 1000) => ({ type: 'user', timestamp: new Date(at).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] } })

async function scanned(records, marker = {}) {
  const fx = await fakeClaude({ transcript: [typed('help'), ...records] })
  try {
    await writeMarker(fx.configDir, { status: 'busy', at: now - 1000, extra: { entrypoint: 'cli' }, ...marker })
    const h = await claudeWith(fx)
    const threads = (await h.scanThreads()).map(t => ({ ...t, harness: 'claude-code' }))
    return new LiveStatus({ file: fx.root + '/missing' }).overlay(threads)[0]
  } finally { await fsp.rm(fx.root, { recursive: true, force: true }) }
}

for (const name of ['AskUserQuestion', 'ExitPlanMode']) {
  test(`${name} waits through progress and unrelated results, then clears on its own answer`, async () => {
    const records = [assistant([call(name), call('Bash', 'other')]), { type: 'progress' }, result('other')]
    assert.equal(statusFor(await scanned(records)), 'waiting')
    assert.equal(statusFor(await scanned([...records, result('ask')])), 'working')
  })
}
test('newer explicit completed reply beats an older busy marker', async () => {
  const records = [assistant([{ type: 'text', text: 'Your turn.' }], now, 'end_turn')]
  assert.equal(statusFor(await scanned(records)), 'waiting')
  assert.equal(statusFor(await scanned(records, { at: now + 1000 })), 'working')
})
test('intermediate text with no end-turn signal does not override busy', async () => {
  assert.equal(statusFor(await scanned([assistant([{ type: 'text', text: 'Let me check.' }], now, null)])), 'working')
})
test('a new human turn clears a pending question', async () => {
  assert.equal(statusFor(await scanned([assistant([call('AskUserQuestion')]), { ...typed('Never mind, continue'), timestamp: new Date(now + 1000).toISOString() }])), 'working')
})
test('an idle terminal marker does not leave a pending ordinary tool marked running', async () => {
  const t = await scanned([assistant([call('Bash')])], { status: 'idle', at: now + 1000 })
  assert.equal(t.running, false)
  assert.equal(t.terminalLive, true)
})
test('a question left open longer than thirty minutes still waits in a live terminal', async () => {
  assert.equal(statusFor(await scanned([assistant([call('AskUserQuestion')], now - 3600000)], { at: now - 3601000 })), 'waiting')
})
