import test from 'node:test'
import assert from 'node:assert/strict'
import { EnvironmentController } from '../src/game/environment-controller.js'
import { ENVIRONMENT_DEFAULTS, locationKey } from '../src/world/environment.js'

const location = { label: 'Test city', latitude: 40, longitude: -70, timezone: 'America/New_York' }
const instant = Date.parse('2026-10-11T12:00:00Z')
const reading = () => ({ locationKey: locationKey(location), condition: 'rain', intensity: 0.5, temperatureC: 12, cloudCover: 0.8, windSpeedMs: 2, windDirectionDeg: 180, validAt: instant, fetchedAt: instant })
function fixture(values = {}, current) {
  let mono = 0, wall = instant
  const listeners = new Set(), events = new Map(), store = new Map()
  const settings = { values: { ...ENVIRONMENT_DEFAULTS, ...values }, get(k) { return this.values[k] }, set(k,v) { if (this.values[k] === v) return; this.values[k] = v; for (const fn of listeners) fn(new Set([k])) }, onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  const doc = { hidden: false, addEventListener(k, fn) { events.set(k, fn) }, removeEventListener(k) { events.delete(k) } }
  const storage = { getItem: k => store.get(k), setItem: (k,v) => store.set(k,v) }
  const options = { now: () => wall, monotonic: () => mono, document: doc, window: null, storage, current }
  const c = new EnvironmentController(settings, options)
  return { c, settings, doc, events, options, tick(seconds) { mono += seconds * 1000; wall += seconds * 1000; return c.update() }, advanceWall(seconds) { wall += seconds * 1000 } }
}

// @spec:WS-008
test('snow cover builds only during active snowfall, melts and resets off or unavailable', () => {
  const f = fixture({ environmentMode: 'manual', manualWeather: 'snow' })
  for (let i = 0; i < 10; i++) f.tick(1)
  const cover = f.c.state.snowCover
  assert.ok(cover > 0.3 && cover < 1)
  f.doc.hidden = true; f.tick(4); assert.equal(f.c.state.snowCover, cover)
  f.doc.hidden = false; f.tick(60); assert.equal(f.c.state.snowCover, cover)
  f.settings.set('manualWeather', 'clear'); f.tick(1)
  assert.ok(f.c.state.snowCover < cover)
  for (let i = 0; i < 60; i++) f.tick(1)
  assert.equal(f.c.state.snowCover, 0)
  f.settings.set('manualWeather', 'snow')
  for (let i = 0; i < 60; i++) f.tick(1)
  assert.equal(f.c.state.snowCover, 1)
  f.settings.set('manualWeather', 'rain'); f.tick(1)
  assert.ok(f.c.state.snowCover <= 0.95)
  f.settings.set('environmentMode', 'off'); f.tick(1)
  assert.equal(f.c.state.snowCover, 0)
  f.settings.set('manualWeather', 'snow'); f.settings.set('environmentMode', 'manual'); f.tick(1)
  assert.ok(f.c.state.snowCover > 0)
  f.settings.set('environmentMode', 'actual'); f.tick(1)
  assert.equal(f.c.state.snowCover, 0)
  f.c.dispose()
})
// @spec:WS-002, WS-007
test('WS2/WS7: active cycle counts low FPS but pauses hidden/sleep and preserves speed phase', () => {
  const f = fixture({ environmentMode: 'simulated', simulatedYearMinutes: 4 })
  f.tick(2); assert.ok(Math.abs(f.c.phase - 2/240) < 1e-9)
  f.doc.hidden = true; f.tick(2); assert.ok(Math.abs(f.c.phase - 2/240) < 1e-9)
  f.doc.hidden = false; f.tick(60); assert.ok(Math.abs(f.c.phase - 2/240) < 1e-9)
  f.settings.set('simulatedYearMinutes', 8); f.tick(2); assert.ok(Math.abs(f.c.phase - (2/240 + 2/480)) < 1e-9)
  f.settings.set('timeOfDay', 0.9); assert.equal(f.settings.get('environmentMode'), 'simulated')
  f.c.dispose(); assert.equal(f.events.size, 0)
  const resumed = new EnvironmentController(f.settings, f.options)
  assert.equal(resumed.phase, f.c.phase); resumed.dispose()
})
// @spec:WS-003
test('WS3: seasonal mode uses saved calendar and makes no weather requests', () => {
  let calls = 0
  const f = fixture({ environmentMode: 'seasonal', weatherLocation: location }, () => { calls++ })
  assert.equal(f.tick(1).season, 'autumn'); assert.equal(calls, 0); f.c.dispose()
})
// @spec:WS-004
test('WS4: retains matching cache and timestamps on failures, restores offline after reload', async () => {
  let fail = false
  const f = fixture({ environmentMode: 'actual', weatherLocation: location }, async () => { if (fail) throw new Error('offline'); return reading() })
  f.tick(1); await new Promise(setImmediate)
  assert.equal(f.tick(1).condition, 'rain')
  fail = true; f.advanceWall(901); f.tick(1); await new Promise(setImmediate)
  const state = f.tick(1); assert.equal(state.stale, true); assert.equal(state.reading.fetchedAt, instant)
  f.c.dispose()
  const restored = new EnvironmentController(f.settings, f.options)
  assert.equal(restored.update().condition, 'rain'); restored.dispose()
})
// @spec:WS-006
test('WS6: city switch rejects late responses and never carries the old reading', async () => {
  let resolve
  const f = fixture({ environmentMode: 'actual', weatherLocation: location }, () => new Promise(r => { resolve = r }))
  f.tick(1)
  f.settings.set('weatherLocation', { ...location, longitude: 10 })
  resolve(reading()); await new Promise(setImmediate)
  assert.equal(f.tick(1).unavailable, true)
  f.settings.set('environmentMode', 'manual'); f.settings.set('manualWeather', 'snow')
  assert.equal(f.tick(1).condition, 'snow'); f.c.dispose()
})
// @spec:WS-004
test('WS4: no-cache failure is unavailable, unknown/invalid reading is never adopted', async () => {
  const f = fixture({ environmentMode: 'actual', weatherLocation: location }, async () => ({ ...reading(), condition: 'unknown' }))
  f.tick(1); await new Promise(setImmediate)
  assert.equal(f.tick(1).unavailable, true); assert.equal(f.c.state.reading, null); f.c.dispose()
})

// @spec:WS-008
test('WS8: snowfall fades without turning into rain when clear weather is selected', () => {
  const f = fixture({ environmentMode: 'manual', manualWeather: 'snow' })
  f.tick(3); assert.equal(f.c.state.precipitationKind,'snow')
  f.settings.set('manualWeather','clear'); f.tick(1)
  assert.equal(f.c.state.precipitationKind,'snow'); assert.ok(f.c.state.precipitation > 0)
  f.c.dispose()
})

// @spec:WS-004, WS-006
test('WS4/WS6: hidden views pause polling and mode changes ignore outstanding responses', async () => {
  let calls = 0, resolve
  const f = fixture({ environmentMode: 'actual', weatherLocation: location }, () => { calls++; return new Promise(r => { resolve = r }) })
  f.doc.hidden = true; f.tick(1); assert.equal(calls,0)
  f.doc.hidden = false; f.events.get('visibilitychange')(); f.tick(1); assert.equal(calls,1)
  f.settings.set('environmentMode','off'); resolve(reading()); await new Promise(setImmediate)
  f.tick(1); assert.equal(f.c.state.enabled,false); assert.equal(Object.keys(f.c.cache).length,0)
  f.c.dispose()
})
