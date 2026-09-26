/**
 * AC5: hooks are opt-in and reversible. The installer is the only thing in Moon Base that ever edits
 * a tool's config, so everything that could go wrong with that is tested here, against a temp HOME
 * and never a real one.
 *
 * "Untouched" means byte-for-byte: the files a user already has come out exactly as they went in.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  applyPlan,
  installSupportFiles,
  planInstall,
  planUninstall,
  removeSupportFiles,
  status,
} from '../hooks/install.mjs'
import { run } from '../hooks/cli.mjs'

const ROOT = new URL('..', import.meta.url).pathname

async function withHome(fn) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'install-home-'))
  const ctx = { env: {}, home }
  const paths = {
    claude: path.join(home, '.claude', 'settings.json'),
    codexHooks: path.join(home, '.codex', 'hooks.json'),
    codexConfig: path.join(home, '.codex', 'config.toml'),
    moon: path.join(home, '.moon-base'),
  }
  const write = async (file, text) => {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, text)
  }
  try {
    return await fn({ ctx, home, paths, write })
  } finally {
    await fsp.rm(home, { recursive: true, force: true })
  }
}

const read = (f) => fs.readFileSync(f, 'utf8')
const exists = (f) => fs.existsSync(f)

/** Plan, then apply, the way the CLI does after a yes. */
async function install(ctx, tool) {
  const plan = await planInstall(tool, ctx)
  if (plan.changed) {
    await installSupportFiles(ctx)
    await applyPlan(plan, ctx)
  }
  return plan
}

const USER_CLAUDE = {
  theme: 'dark',
  enabledPlugins: { 'a@b': true },
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/usr/local/bin/audit' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
  },
}
const json = (o) => JSON.stringify(o, null, 2) + '\n'

const oursOnly = (groups) => groups.filter((g) => g.hooks.some((h) => /moon-base-hook/.test(h.command)))
const commandsOf = (groups) => groups.flatMap((g) => g.hooks.map((h) => h.command))

// ── what gets registered ──────────────────────────────────────────────────────

test('Claude Code gets exactly the planned events, with the terminal ones synchronous', async () => {
  await withHome(async ({ ctx, paths }) => {
    await install(ctx, 'claude')
    const hooks = JSON.parse(read(paths.claude)).hooks
    assert.deepEqual(Object.keys(hooks).sort(), ['Notification', 'PermissionRequest', 'PostToolUse', 'Stop', 'StopFailure', 'SessionEnd', 'UserPromptSubmit'].sort())
    for (const [event, groups] of Object.entries(hooks)) {
      const [handler] = oursOnly(groups)[0].hooks
      assert.equal(handler.type, 'command')
      assert.match(handler.command, /moon-base-hook claude$/)
      assert.equal(handler.async === true, !['Stop', 'StopFailure', 'SessionEnd'].includes(event), `${event} async`)
    }
    assert.equal(hooks.Notification[0].matcher, 'permission_prompt|elicitation_dialog')
  })
})

test('Codex gets exactly the planned events, and never a failure or notification event', async () => {
  await withHome(async ({ ctx, paths }) => {
    await install(ctx, 'codex')
    const hooks = JSON.parse(read(paths.codexHooks)).hooks
    assert.deepEqual(Object.keys(hooks).sort(), ['PermissionRequest', 'PostToolUse', 'SessionEnd', 'Stop', 'UserPromptSubmit'].sort())
    for (const [event, groups] of Object.entries(hooks)) {
      const [handler] = groups[0].hooks
      assert.match(handler.command, /moon-base-hook codex$/)
      assert.equal(handler.timeout, 3, 'inside the 3 second limit Codex puts on some events')
      assert.equal(handler.async === true, !['Stop', 'SessionEnd'].includes(event), `${event} async`)
    }
  })
})

// ── only marked entries are added (AC5) ───────────────────────────────────────

test('installing leaves every existing key and hook where it was, and only appends ours', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await write(paths.claude, json(USER_CLAUDE))
    await install(ctx, 'claude')
    const after = JSON.parse(read(paths.claude))
    assert.equal(after.theme, 'dark')
    assert.deepEqual(after.enabledPlugins, USER_CLAUDE.enabledPlugins)
    assert.deepEqual(after.hooks.PreToolUse, USER_CLAUDE.hooks.PreToolUse, 'an event we do not use is untouched')
    assert.deepEqual(after.hooks.Stop[0], USER_CLAUDE.hooks.Stop[0], 'the user’s own Stop hook keeps position 0')
    assert.equal(after.hooks.Stop.length, 2)
    assert.match(after.hooks.Stop[1].hooks[0].command, /moon-base-hook/)
    assert.deepEqual(Object.keys(after), ['theme', 'enabledPlugins', 'hooks'], 'key order is kept')
  })
})

test('a Codex hooks.json the user already has keeps their hooks in place', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    const mine = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine', timeout: 5 }] }] } }
    await write(paths.codexHooks, json(mine))
    await install(ctx, 'codex')
    const after = JSON.parse(read(paths.codexHooks))
    assert.deepEqual(after.hooks.Stop[0], mine.hooks.Stop[0], 'position 0 is theirs, so their trust is unaffected')
    assert.match(after.hooks.Stop[1].hooks[0].command, /moon-base-hook codex/)
  })
})

test('the diff shown is exactly what is written: additions only, for a file that had hooks already', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await write(paths.claude, json(USER_CLAUDE))
    const plan = await planInstall('claude', ctx)
    const removed = plan.diff.split('\n').filter((l) => /^-(?!--)/.test(l))
    assert.deepEqual(removed.filter((l) => !/^-\s*[\]\}],?$/.test(l) && !/"Stop": \[|"PreToolUse": \[|^-\s*\}$/.test(l)).length, 0, 'nothing of the user’s is removed')
    assert.match(plan.diff, /^\+.*moon-base-hook/m)
    assert.equal(plan.file, paths.claude)
    await applyPlan(plan, ctx)
    assert.equal(read(paths.claude), plan.after)
  })
})

test('a Codex config.toml with a notify entry and trust state is never read for writing or changed', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    const toml = 'model = "gpt-5.5"\nnotify = ["/path/turn-ended", "x"]\n\n[hooks.state."/p/hooks.json:stop:0:0"]\ntrusted_hash = "sha256:abc"\n'
    await write(paths.codexConfig, toml)
    await install(ctx, 'codex')
    assert.equal(read(paths.codexConfig), toml)
    await applyPlan(await planUninstall('codex', ctx), ctx)
    assert.equal(read(paths.codexConfig), toml)
  })
})

test('a config.toml that defines hooks inline is flagged, because Codex will merge and warn', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await write(paths.codexConfig, '[[hooks.Stop]]\nmatcher = "x"\n')
    const plan = await planInstall('codex', ctx)
    assert.ok(plan.notes.some((n) => /inline/i.test(n)))
    assert.equal(plan.error, undefined)
  })
})

// ── opt-in: nothing happens without a yes ─────────────────────────────────────

test('a dry run shows the diff and writes nothing at all, not even support files', async () => {
  await withHome(async ({ home, paths, write }) => {
    await write(paths.claude, json(USER_CLAUDE))
    const out = []
    const code = await run(['install-hooks', '--dry-run'], { env: {}, home, out: (t) => out.push(t), err: () => {} })
    assert.equal(code, 0)
    assert.match(out.join('\n'), /moon-base-hook/)
    assert.equal(read(paths.claude), json(USER_CLAUDE))
    assert.equal(exists(paths.codexHooks), false)
    assert.equal(exists(paths.moon), false)
  })
})

test('declining leaves every file byte-for-byte as it was and creates nothing', async () => {
  await withHome(async ({ home, paths, write }) => {
    await write(paths.claude, json(USER_CLAUDE))
    const out = []
    const code = await run(['install-hooks'], { env: {}, home, out: (t) => out.push(t), err: () => {}, confirm: async () => false })
    assert.equal(code, 1)
    assert.equal(read(paths.claude), json(USER_CLAUDE))
    assert.equal(exists(paths.codexHooks), false)
    assert.equal(exists(paths.moon), false)
    assert.match(out.join('\n'), /no changes/i)
  })
})

test('a yes applies the shown change, and each tool is asked about separately', async () => {
  await withHome(async ({ home, paths }) => {
    const asked = []
    const code = await run(['install-hooks'], {
      env: {},
      home,
      out: () => {},
      err: () => {},
      confirm: async (q) => (asked.push(q), /claude/i.test(q)),
    })
    assert.equal(code, 0)
    assert.equal(asked.length, 2)
    assert.equal(exists(paths.claude), true)
    assert.equal(exists(paths.codexHooks), false, 'the second question was answered no')
  })
})

test('there is no way to skip the question: --yes is not an option, and a pipe cannot answer', async () => {
  await withHome(async ({ home, paths }) => {
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', CODEX_HOME: '', MOON_BASE_HOME: '' }
    const bin = path.join(ROOT, 'bin', 'moon-base.mjs')
    const yes = spawnSync(process.execPath, [bin, 'install-hooks', '--yes'], { env, encoding: 'utf8', input: 'y\n' })
    assert.equal(yes.status, 2)
    const piped = spawnSync(process.execPath, [bin, 'install-hooks'], { env, encoding: 'utf8', input: 'y\n' })
    assert.notEqual(piped.status, 0)
    assert.match(piped.stdout + piped.stderr, /interactive|terminal/i)
    assert.equal(exists(paths.claude), false)
    assert.equal(exists(paths.moon), false)
  })
})

test('the CLI dry run works from a real process', async () => {
  await withHome(async ({ home, paths }) => {
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', CODEX_HOME: '', MOON_BASE_HOME: '' }
    const done = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'moon-base.mjs'), 'install-hooks', '--dry-run', '--tool', 'codex'], { env, encoding: 'utf8' })
    assert.equal(done.status, 0)
    assert.match(done.stdout, /hooks\.json/)
    assert.equal(exists(paths.codexHooks), false)
  })
})

test('an unknown command or option is a usage error and does nothing', async () => {
  await withHome(async ({ home, paths }) => {
    for (const argv of [[], ['frobnicate'], ['install-hooks', '--tool', 'cursor'], ['install-hooks', '--force']]) {
      const code = await run(argv, { env: {}, home, out: () => {}, err: () => {}, confirm: async () => true })
      assert.equal(code, 2, argv.join(' '))
    }
    assert.equal(exists(paths.claude), false)
  })
})

// ── reversible ────────────────────────────────────────────────────────────────

test('install then uninstall gives back the exact bytes of every file that existed', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await write(paths.claude, json(USER_CLAUDE))
    const mine = json({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } })
    await write(paths.codexHooks, mine)
    await install(ctx, 'claude')
    await install(ctx, 'codex')
    assert.notEqual(read(paths.claude), json(USER_CLAUDE))
    await applyPlan(await planUninstall('claude', ctx), ctx)
    await applyPlan(await planUninstall('codex', ctx), ctx)
    assert.equal(read(paths.claude), json(USER_CLAUDE))
    assert.equal(read(paths.codexHooks), mine)
  })
})

test('files the installer created are removed again; files it did not create are kept', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await install(ctx, 'claude')
    await install(ctx, 'codex')
    assert.equal(exists(paths.claude), true)
    assert.equal(exists(paths.codexHooks), true)
    await applyPlan(await planUninstall('claude', ctx), ctx)
    await applyPlan(await planUninstall('codex', ctx), ctx)
    assert.equal(exists(paths.claude), false)
    assert.equal(exists(paths.codexHooks), false)

    await write(paths.claude, '{}\n')
    await install(ctx, 'claude')
    await applyPlan(await planUninstall('claude', ctx), ctx)
    assert.equal(exists(paths.claude), true, 'a settings.json that was already there stays')
    assert.deepEqual(JSON.parse(read(paths.claude)), {})
  })
})

test('uninstall removes only Moon Base entries, even when the user has edited around them', async () => {
  await withHome(async ({ ctx, paths }) => {
    await install(ctx, 'claude')
    const edited = JSON.parse(read(paths.claude))
    edited.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo added-later' }] })
    edited.model = 'opus'
    await fsp.writeFile(paths.claude, json(edited))
    await applyPlan(await planUninstall('claude', ctx), ctx)
    const after = JSON.parse(read(paths.claude))
    assert.equal(after.model, 'opus')
    assert.deepEqual(commandsOf(after.hooks.Stop), ['echo added-later'])
    assert.deepEqual(Object.keys(after.hooks), ['Stop'])
  })
})

test('installing twice changes nothing the second time', async () => {
  await withHome(async ({ ctx, paths }) => {
    await install(ctx, 'claude')
    const once = read(paths.claude)
    const again = await planInstall('claude', ctx)
    assert.equal(again.changed, false)
    assert.match(again.notes.join(' '), /already/i)
    await install(ctx, 'claude')
    assert.equal(read(paths.claude), once)
  })
})

test('uninstalling what is not installed changes nothing', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await write(paths.claude, json(USER_CLAUDE))
    const plan = await planUninstall('claude', ctx)
    assert.equal(plan.changed, false)
    assert.equal(read(paths.claude), json(USER_CLAUDE))
  })
})

// ── failing safely ────────────────────────────────────────────────────────────

test('a config that is not valid JSON is refused, and left exactly as it is', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await write(paths.claude, '{ "hooks": ')
    await write(paths.codexHooks, 'not json')
    for (const tool of ['claude', 'codex']) {
      const plan = await planInstall(tool, ctx)
      assert.ok(plan.error, tool)
      assert.equal(plan.changed, false)
      await assert.rejects(applyPlan(plan, ctx))
    }
    assert.equal(read(paths.claude), '{ "hooks": ')
    assert.equal(read(paths.codexHooks), 'not json')
  })
})

test('a config whose hooks are not the shape we expect is refused, not repaired', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    const odd = json({ hooks: { Stop: 'nope' } })
    await write(paths.claude, odd)
    const plan = await planInstall('claude', ctx)
    assert.ok(plan.error)
    assert.equal(read(paths.claude), odd)
  })
})

test('a file changed while you were reviewing the diff is not overwritten', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await write(paths.claude, json(USER_CLAUDE))
    const plan = await planInstall('claude', ctx)
    const meanwhile = json({ ...USER_CLAUDE, model: 'changed-by-claude-code' })
    await fsp.writeFile(paths.claude, meanwhile)
    await assert.rejects(applyPlan(plan, ctx), /changed/i)
    assert.equal(read(paths.claude), meanwhile)
  })
})

test('a file that appears while you were reviewing is not overwritten either', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    const plan = await planInstall('claude', ctx)
    await write(paths.claude, json({ theme: 'light' }))
    await assert.rejects(applyPlan(plan, ctx), /changed|exists/i)
    assert.equal(read(paths.claude), json({ theme: 'light' }))
  })
})

test('a read-only target fails cleanly: the original is intact and no temp file is left behind', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await write(paths.claude, json(USER_CLAUDE))
    const plan = await planInstall('claude', ctx)
    await fsp.chmod(path.dirname(paths.claude), 0o555)
    try {
      await assert.rejects(applyPlan(plan, ctx))
    } finally {
      await fsp.chmod(path.dirname(paths.claude), 0o755)
    }
    assert.equal(read(paths.claude), json(USER_CLAUDE))
    assert.deepEqual(await fsp.readdir(path.dirname(paths.claude)), ['settings.json'])
  })
})

test('a symlinked settings.json stays a symlink and the real file is what changes', async () => {
  await withHome(async ({ ctx, home, paths }) => {
    const real = path.join(home, 'dotfiles', 'claude-settings.json')
    await fsp.mkdir(path.dirname(real), { recursive: true })
    await fsp.writeFile(real, json(USER_CLAUDE))
    await fsp.mkdir(path.dirname(paths.claude), { recursive: true })
    await fsp.symlink(real, paths.claude)
    await install(ctx, 'claude')
    assert.equal(fs.lstatSync(paths.claude).isSymbolicLink(), true)
    assert.match(read(real), /moon-base-hook/)
  })
})

test('a file’s permissions are kept when it is rewritten', async () => {
  await withHome(async ({ ctx, paths, write }) => {
    await write(paths.claude, json(USER_CLAUDE))
    await fsp.chmod(paths.claude, 0o600)
    await install(ctx, 'claude')
    assert.equal(fs.statSync(paths.claude).mode & 0o777, 0o600)
  })
})

// ── what gets put next to the tools' configs ──────────────────────────────────

test('the support files are a private directory, an executable wrapper, the script and the Node path', async () => {
  await withHome(async ({ ctx, paths }) => {
    await installSupportFiles(ctx)
    const bin = path.join(paths.moon, 'bin')
    assert.equal(fs.statSync(bin).mode & 0o777, 0o700)
    assert.equal(fs.statSync(path.join(bin, 'moon-base-hook')).mode & 0o111, 0o111)
    assert.equal(read(path.join(bin, 'moon-base-hook.mjs')), read(path.join(ROOT, 'hooks', 'moon-base-hook.mjs')))
    assert.equal(read(path.join(bin, 'node-path')).trim(), process.execPath)
  })
})

test('the wrapper records an event through the installed script, silently, and exits 0 whatever Node it finds', async () => {
  await withHome(async ({ ctx, home, paths }) => {
    await installSupportFiles(ctx)
    const wrapper = path.join(paths.moon, 'bin', 'moon-base-hook')
    const payload = JSON.stringify({ hook_event_name: 'Stop', session_id: '01a0dbe1-e660-7c61-999c-16e6243ba432' })
    const go = (env) => spawnSync(wrapper, ['claude'], { input: payload, env, encoding: 'utf8' })

    const ok = go({ PATH: '/usr/bin:/bin', HOME: home })
    assert.equal(ok.status, 0)
    assert.equal(ok.stdout + ok.stderr, '')
    assert.match(read(path.join(paths.moon, 'events', 'events.jsonl')), /"event":"Stop"/)

    // A stale node-path (the Node it named has been uninstalled): falls back to PATH.
    await fsp.writeFile(path.join(paths.moon, 'bin', 'node-path'), '/no/such/node\n')
    const stale = go({ PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: home })
    assert.equal(stale.status, 0)
    assert.equal(read(path.join(paths.moon, 'events', 'events.jsonl')).trim().split('\n').length, 2)

    // No Node anywhere: still exits 0 with nothing on the screen.
    const none = go({ PATH: '/nonexistent', HOME: home })
    assert.equal(none.status, 0)
    assert.equal(none.stdout + none.stderr, '')
  })
})

test('uninstalling every tool removes the support files, and keeps the events', async () => {
  await withHome(async ({ ctx, paths }) => {
    await install(ctx, 'claude')
    await fsp.mkdir(path.join(paths.moon, 'events'), { recursive: true })
    await fsp.writeFile(path.join(paths.moon, 'events', 'events.jsonl'), '{}\n')
    await applyPlan(await planUninstall('claude', ctx), ctx)
    await removeSupportFiles(ctx)
    assert.equal(exists(path.join(paths.moon, 'bin')), false)
    assert.equal(exists(path.join(paths.moon, 'events', 'events.jsonl')), true)
  })
})

// ── status ────────────────────────────────────────────────────────────────────

test('status says what is installed, and for Codex explains the silent trust step', async () => {
  await withHome(async ({ ctx, paths }) => {
    let s = await status(ctx)
    assert.equal(s.claude.installed, false)
    assert.equal(s.codex.installed, false)

    await install(ctx, 'claude')
    await install(ctx, 'codex')
    s = await status(ctx)
    assert.equal(s.claude.installed, true)
    assert.equal(s.codex.installed, true)
    assert.match(s.codex.advice, /\/hooks/, 'installed but never fired: point at the trust review')
    assert.match(s.claude.advice, /no event/i)

    await fsp.mkdir(path.join(paths.moon, 'events'), { recursive: true })
    const ts = Date.now() - 60_000
    await fsp.writeFile(
      path.join(paths.moon, 'events', 'events.jsonl'),
      JSON.stringify({ v: 1, ts, tool: 'codex', event: 'Stop', sessionId: '01a0dbe1-e660-7c61-999c-16e6243ba432' }) + '\n',
      { mode: 0o600 }
    )
    await fsp.chmod(path.join(paths.moon, 'events'), 0o700)
    s = await status(ctx)
    assert.equal(s.codex.lastEventAt, ts)
    assert.doesNotMatch(s.codex.advice || '', /\/hooks/)
    assert.equal(s.claude.lastEventAt, 0)
  })
})

test('a partly installed tool is reported as such, not as installed', async () => {
  await withHome(async ({ ctx, paths }) => {
    await install(ctx, 'claude')
    const partial = JSON.parse(read(paths.claude))
    delete partial.hooks.Stop
    await fsp.writeFile(paths.claude, json(partial))
    const s = await status(ctx)
    assert.equal(s.claude.installed, false)
    assert.match(s.claude.advice, /partly|missing/i)
  })
})

// ── nothing else ever edits a config (AC5, D5) ────────────────────────────────

test('starting the server and using every route never touches a tool config', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'server-home-'))
  const files = {
    [path.join(home, '.claude', 'settings.json')]: json(USER_CLAUDE),
    [path.join(home, '.codex', 'hooks.json')]: json({ hooks: {} }),
    [path.join(home, '.codex', 'config.toml')]: 'notify = ["x"]\n',
  }
  for (const [f, text] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(f), { recursive: true })
    await fsp.writeFile(f, text)
  }
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import http from 'node:http'
       const { apiMiddleware } = await import(${JSON.stringify(path.join(ROOT, 'server', 'api.mjs'))})
       const server = http.createServer((req, res) => apiMiddleware(req, res, null))
       await new Promise((r) => server.listen(0, '127.0.0.1', r))
       const port = server.address().port
       const call = (p, o) => fetch('http://127.0.0.1:' + port + p, { headers: { Origin: 'http://localhost:' + port }, ...o })
       await call('/api/threads'); await call('/api/harnesses'); await call('/api/state')
       await call('/api/state', { method: 'PUT', body: '{}' })
       server.close()`,
    ],
    { env: { ...process.env, HOME: home, MOON_BASE_DATA: path.join(home, 'data'), CLAUDE_CONFIG_DIR: '', CODEX_HOME: '' }, encoding: 'utf8', timeout: 30000 }
  )
  assert.equal(child.status, 0, child.stderr)
  for (const [f, text] of Object.entries(files)) assert.equal(read(f), text, f)
  assert.equal(exists(path.join(home, '.moon-base', 'bin')), false)
  await fsp.rm(home, { recursive: true, force: true })
})

test('no server or page code knows where a tool keeps its config, and nothing anywhere uses the trust bypass', async () => {
  const walk = async (dir) => {
    const out = []
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) out.push(...(await walk(p)))
      else if (/\.(m?js|sh|json)$/.test(e.name) || e.name === 'moon-base-hook') out.push(p)
    }
    return out
  }
  for (const dir of ['server', 'src']) {
    for (const f of await walk(path.join(ROOT, dir))) {
      assert.doesNotMatch(read(f), /settings\.json|hooks\.json|config\.toml/, `${path.relative(ROOT, f)} must not know where a tool keeps its config`)
    }
  }
  for (const dir of ['server', 'src', 'hooks', 'bin', 'tools']) {
    for (const f of await walk(path.join(ROOT, dir))) {
      assert.doesNotMatch(read(f), /dangerously-bypass-hook-trust/, path.relative(ROOT, f))
    }
  }
})

// ── found in review ───────────────────────────────────────────────────────────

test('uninstalling one tool keeps the shared hook while the other still uses it, even with the record gone', async () => {
  await withHome(async ({ ctx, home, paths }) => {
    await install(ctx, 'claude')
    await install(ctx, 'codex')
    await fsp.rm(path.join(paths.moon, 'install.json')) // a lost record must not change the answer
    const yes = async () => true
    const io = { env: {}, home, out: () => {}, err: () => {}, confirm: yes }
    assert.equal(await run(['uninstall-hooks', '--tool', 'claude'], io), 0)
    assert.equal(exists(path.join(paths.moon, 'bin', 'moon-base-hook')), true, 'Codex still points at it')
    assert.equal(await run(['uninstall-hooks', '--tool', 'codex'], io), 0)
    assert.equal(exists(path.join(paths.moon, 'bin')), false, 'nothing points at it any more')
  })
})

test('the installed command is safe in a home directory with spaces, quotes and shell syntax', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hostile-'))
  const home = path.join(root, "it's $(touch PWNED) `touch PWNED2` & ; home")
  await fsp.mkdir(home)
  try {
    const ctx = { env: {}, home }
    await install(ctx, 'claude')
    const settings = JSON.parse(read(path.join(home, '.claude', 'settings.json')))
    const command = settings.hooks.Stop[0].hooks[0].command
    const payload = JSON.stringify({ hook_event_name: 'Stop', session_id: '01a0dbe1-e660-7c61-999c-16e6243ba432' })
    // Exactly how the tool runs it: through a shell, with the tool's own working directory.
    const done = spawnSync('/bin/sh', ['-c', command], { input: payload, cwd: root, env: { PATH: '/usr/bin:/bin', HOME: home }, encoding: 'utf8' })
    assert.equal(done.status, 0)
    assert.equal(done.stdout + done.stderr, '')
    for (const dir of [root, home]) {
      assert.deepEqual((await fsp.readdir(dir)).filter((n) => n.startsWith('PWNED')), [], 'nothing in the path was executed')
    }
    assert.match(read(path.join(home, '.moon-base', 'events', 'events.jsonl')), /"event":"Stop"/, 'and the hook really ran')
    // The same path is still recognised as ours, so it can be removed again.
    const removal = await planUninstall('claude', ctx)
    assert.equal(removal.changed, true)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

const EXPECT = '/usr/bin/expect'
test('the real terminal prompt: a typed n changes nothing, a typed y installs', { skip: !fs.existsSync(EXPECT) }, async () => {
  await withHome(async ({ home, paths }) => {
    const bin = path.join(ROOT, 'bin', 'moon-base.mjs')
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', CODEX_HOME: '', MOON_BASE_HOME: '' }
    const answer = (reply) =>
      spawnSync(
        EXPECT,
        ['-c', `set timeout 20\nspawn -noecho ${process.execPath} ${bin} install-hooks --tool codex\nexpect -re {\\[y/N\\]}\nsend "${reply}\\r"\nexpect eof\ncatch wait result\nexit [lindex $result 3]`],
        { env, encoding: 'utf8', timeout: 30000 }
      )
    const no = answer('n')
    assert.equal(no.status, 1, no.stdout + no.stderr)
    assert.equal(exists(paths.codexHooks), false)
    assert.equal(exists(paths.moon), false)
    const yes = answer('y')
    assert.equal(yes.status, 0, yes.stdout + yes.stderr)
    assert.equal(exists(paths.codexHooks), true)
    assert.match(read(paths.codexHooks), /moon-base-hook codex/)
  })
})

