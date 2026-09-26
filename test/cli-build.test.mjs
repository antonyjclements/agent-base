/**
 * AC15, being fast: a ready build is served as it is, and a build is made only when there is none or the
 * source is newer than it. What counts as source is fixed, dotfiles are ignored (a Finder's `.DS_Store`
 * must not force a rebuild), and a failed build stops the start with its own output.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildState, runBuild } from '../cli/build.mjs'

const T = (n) => new Date(Date.UTC(2026, 8, 26, 12, 0, n))

async function withTree(fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'build-'))
  const put = async (rel, at, body = 'x') => {
    const file = path.join(root, rel)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, body)
    await fsp.utimes(file, at, at)
  }
  try {
    return await fn({ root, put })
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
}

const sources = async (put, at) => {
  await put('src/main.js', at)
  await put('src/ui/hud.js', at)
  await put('public/assets/a.glb', at)
  await put('index.html', at)
  await put('vite.config.js', at)
  await put('package.json', at)
}

test('no dist at all is a build to make', async () => {
  await withTree(async ({ root, put }) => {
    await sources(put, T(1))
    assert.equal((await buildState({ root })).state, 'missing')
  })
})

test('a dist newer than every source is fresh, and an equal one is too', async () => {
  await withTree(async ({ root, put }) => {
    await sources(put, T(1))
    await put('dist/index.html', T(2))
    assert.equal((await buildState({ root })).state, 'fresh')
    await put('dist/index.html', T(1))
    assert.equal((await buildState({ root })).state, 'fresh')
  })
})

test('a source newer than the build makes it stale, wherever it is under a watched folder', async () => {
  for (const changed of ['src/main.js', 'src/ui/hud.js', 'public/assets/a.glb', 'index.html', 'vite.config.js', 'package.json', 'src/new/deep/file.js']) {
    await withTree(async ({ root, put }) => {
      await sources(put, T(1))
      await put('dist/index.html', T(5))
      await put(changed, T(9))
      const s = await buildState({ root })
      assert.equal(s.state, 'stale', changed)
      assert.ok(s.sourceAt > s.distAt)
    })
  }
})

test('what is not source does not count: dotfiles, node_modules, tests, docs, data and the build itself', async () => {
  await withTree(async ({ root, put }) => {
    await sources(put, T(1))
    await put('dist/index.html', T(5))
    for (const ignored of ['src/.DS_Store', 'public/.DS_Store', 'node_modules/x/index.js', 'test/a.test.mjs', 'docs/a.md', 'data/colony.json', 'dist/assets/app.js', 'README.md', 'server/api.mjs']) {
      await put(ignored, T(50))
    }
    assert.equal((await buildState({ root })).state, 'fresh')
  })
})

test('a source that is not there is fine', async () => {
  await withTree(async ({ root, put }) => {
    await put('src/main.js', T(1))
    await put('dist/index.html', T(2))
    assert.equal((await buildState({ root })).state, 'fresh')
  })
})

// ── making it ─────────────────────────────────────────────────────────────────

test('a build runs the asset step and then Vite, with this Node, in the project folder', async () => {
  await withTree(async ({ root, put }) => {
    await put('node_modules/vite/bin/vite.js', T(1))
    const calls = []
    const spawn = (cmd, args, opts) => (calls.push({ cmd, args, opts }), { status: 0 })
    assert.equal(await runBuild({ root, spawn, err: () => {} }), 0)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].cmd, process.execPath)
    assert.deepEqual(calls[0].args, ['tools/build-assets.mjs'])
    assert.equal(calls[1].cmd, process.execPath)
    assert.deepEqual(calls[1].args, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build'])
    for (const c of calls) {
      assert.equal(c.opts.cwd, root)
      assert.equal(c.opts.stdio, 'inherit', 'the build speaks for itself')
      assert.ok(!c.opts.shell, 'no shell')
    }
  })
})

test('a failing step stops the build and is the answer', async () => {
  await withTree(async ({ root, put }) => {
    await put('node_modules/vite/bin/vite.js', T(1))
    const calls = []
    const spawn = (cmd, args) => (calls.push(args[0]), { status: args[0] === 'tools/build-assets.mjs' ? 3 : 0 })
    assert.equal(await runBuild({ root, spawn, err: () => {} }), 3)
    assert.equal(calls.length, 1, 'Vite was not run after the assets failed')
  })
})

test('Vite not being installed is said plainly, not as a stack trace', async () => {
  await withTree(async ({ root }) => {
    const lines = []
    const spawn = () => ({ status: 0 })
    assert.notEqual(await runBuild({ root, spawn, err: (l) => lines.push(l) }), 0)
    assert.match(lines.join('\n'), /npm install/)
  })
})

test('a step that cannot even start is a failure', async () => {
  await withTree(async ({ root, put }) => {
    await put('node_modules/vite/bin/vite.js', T(1))
    assert.notEqual(await runBuild({ root, spawn: () => ({ status: null, error: new Error('spawn failed') }), err: () => {} }), 0)
    assert.notEqual(await runBuild({ root, spawn: () => { throw new Error('boom') }, err: () => {} }), 0)
  })
})
