/**
 * Presenting an adapter's answer: what reaches the OS opener, and what is refused before it does.
 *
 * The opener is a recorder throughout, so nothing here launches a real app. The endpoint rules
 * (known ids and folders only, nothing taken from the request) are in `open-security.test.mjs`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { openerCommand, present, setOpener } from '../server/api.mjs'

const opened = []
setOpener((target) => opened.push(target))
test.beforeEach(() => {
  opened.length = 0
})

test("an adapter's own refusal passes through", async () => {
  assert.equal((await present({ ok: false, error: 'nope' })).error, 'nope')
  assert.deepEqual(opened, [])
})

test('no answer at all is a refusal, not a launch', async () => {
  const shown = await present(null)
  assert.equal(shown.ok, false)
  assert.match(shown.error, /Nothing to open/)
  assert.deepEqual(opened, [])
})

test('an answer with no URL is refused, and nothing is launched', async () => {
  const shown = await present({ ok: true, url: '' })
  assert.equal(shown.ok, false)
  assert.match(shown.error, /no deep link/)
  assert.deepEqual(opened, [])
})

test('claude:// and codex:// URLs are passed to the opener exactly as given', async () => {
  for (const url of ['claude://code/new?folder=%2Ftmp%2Fa', 'codex://threads/019cc762-45a2-7112-89cd-cd345c17e834']) {
    const shown = await present({ ok: true, url })
    assert.equal(shown.ok, true)
    assert.equal(shown.url, url)
  }
  assert.equal(opened.length, 2)
})

test('any other scheme, or a URL with control characters or spaces, is refused', async () => {
  const bad = [
    'https://example.com/',
    'http://localhost:5274/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ssh://host/',
    'vscode://file/etc/passwd',
    '/Applications/Calculator.app',
    'claude:',
    'claude://ok\nmalicious',
    'claude://ok\rmalicious',
    'claude://has space',
    'codex://nul\u0000byte',
    ' claude://leading-space',
    'x'.repeat(5000),
  ]
  for (const url of bad) {
    const shown = await present({ ok: true, url })
    assert.equal(shown.ok, false, JSON.stringify(url).slice(0, 60))
  }
  assert.deepEqual(opened, [])
})

test('the OS opener gets the target as one last argument, with no shell in between', () => {
  const target = 'claude://code/new?folder=%2Ftmp%2Fa+b%3B%24%28x%29'
  assert.deepEqual(openerCommand(target, 'darwin'), ['open', target])
  assert.deepEqual(openerCommand(target, 'linux'), ['xdg-open', target])
  assert.deepEqual(openerCommand(target, 'win32'), ['rundll32', 'url.dll,FileProtocolHandler', target])
  assert.equal(openerCommand(target, 'plan9'), null)
})
