import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

const UPSTREAM_URL = 'https://github.com/Station-Sciences/bot-crossing'

// AC12: only the Claude Code and Codex adapters ship.
test('the harness registry lists exactly claude-code and codex', async () => {
  const { HARNESSES } = await import('../server/harnesses/index.mjs')
  assert.deepEqual(HARNESSES.map((h) => h.id).sort(), ['claude-code', 'codex'])
})

test('no other adapter modules ship', () => {
  for (const name of ['antigravity', 'cursor', 'hermes', 'kilocode', 'opencode']) {
    assert.equal(existsSync(path.join(ROOT, 'server/harnesses', `${name}.mjs`)), false, name)
  }
})

// AC9 (name and page title; user-facing strings and the bot come with the theme unit).
test('the package and page are named Moon Base, not Bot Crossing', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.name, 'moon-base')
  for (const key of ['homepage', 'repository', 'bugs', 'author']) {
    assert.doesNotMatch(JSON.stringify(pkg[key] ?? ''), /bot-?crossing|jarren/i, key)
  }
  assert.match(read('index.html'), /<title>Moon Base<\/title>/)
})

test('no name, variable, storage key or page text still says Bot Crossing', async () => {
  // Attribution lives in README.md, UPSTREAM.md and LICENSE only, which are not scanned here.
  const { readdir } = await import('node:fs/promises')
  const found = []
  const scan = async (rel) => {
    const abs = path.join(ROOT, rel)
    const stat = existsSync(abs) ? await import('node:fs').then((m) => m.statSync(abs)) : null
    if (!stat) return
    if (stat.isDirectory()) {
      for (const e of await readdir(abs)) if (e !== 'node_modules') await scan(path.join(rel, e))
    } else if (/\.(m?js|html|css|json|md)$/.test(rel) && rel !== path.join('test', 'identity.test.mjs')) {
      if (/bot[ _-]?crossing/i.test(read(rel))) found.push(rel)
    }
  }
  for (const rel of ['src', 'server', 'hooks', 'bin', 'tools', 'test', 'index.html', 'vite.config.js', 'package.json']) await scan(rel)
  assert.deepEqual(found, [])
})

// AC10: art licensing. Everything third-party is CC0, from its original source, and says so.
test('every shipped model is credited with its source, license and archive hash', async () => {
  const { readdirSync } = await import('node:fs')
  const credits = read('public/assets/CREDITS.md')
  const models = readdirSync(path.join(ROOT, 'public/assets')).filter((f) => f.endsWith('.glb'))
  assert.deepEqual(models.sort(), ['bot.glb', 'forest.glb', 'nature.glb', 'spacebase.glb'])
  for (const file of models) {
    const row = credits.split('\n').find((l) => l.startsWith('|') && l.includes(`\`${file}\``))
    assert.ok(row, `${file} is not credited`)
    assert.match(row, /CC0/, `${file} license`)
    assert.match(row, /https:\/\/(kaylousberg\.itch\.io|kenney\.nl)\//, `${file} source`)
    assert.match(row, /\b[0-9a-f]{64}\b/, `${file} archive hash`)
  }
})

test('nothing but the credited models and the credits file ships in public/assets', async () => {
  const { readdirSync } = await import('node:fs')
  const extra = readdirSync(path.join(ROOT, 'public/assets')).filter((f) => !f.endsWith('.glb') && f !== 'CREDITS.md')
  assert.deepEqual(extra, [])
})

test('the lockfile matches the package name and version', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.name, pkg.name)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].name, pkg.name)
})

// AC5 groundwork: installing dependencies must never run a script that could touch tool configs.
test('package.json defines no install lifecycle scripts', () => {
  const scripts = JSON.parse(read('package.json')).scripts ?? {}
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) {
    assert.equal(name in scripts, false, name)
  }
})

test("upstream's reserved character, design drafts and trademark file are not shipped", () => {
  for (const rel of ['public/assets/crew.glb', 'design', 'TRADEMARKS.md', 'tools/build-crew.mjs']) {
    assert.equal(existsSync(path.join(ROOT, rel)), false, rel)
  }
})

// AC11: license and attribution.
test("LICENSE keeps upstream's MIT notice and adds Moon Base's own line", () => {
  const license = read('LICENSE')
  assert.match(license, /MIT License/)
  assert.match(license, /Copyright \(c\) 2026 Jarren Rocks/)
  assert.match(license, /Permission is hereby granted, free of charge/)
  assert.match(license, /Copyright \(c\) 2026 Moon Base contributors/)
})

test('UPSTREAM.md records the source and the exact imported commit', () => {
  const upstream = read('UPSTREAM.md')
  assert.ok(upstream.includes(UPSTREAM_URL))
  assert.match(upstream, /\b[0-9a-f]{40}\b/)
})

test('the README credits Bot Crossing and disclaims endorsement', () => {
  const readme = read('README.md')
  assert.match(readme, /based on \[?Bot Crossing/i)
  assert.ok(readme.includes(UPSTREAM_URL))
  assert.match(readme, /not endorsed or maintained by/i)
})
