import test from 'node:test'
import assert from 'node:assert/strict'
import { Settings } from '../src/core/settings.js'

// @spec:WS-001, WS-007
test('WS1/WS7: settings preserve environment through quality changes and reject corrupt saved values', () => {
  const prior = globalThis.localStorage
  globalThis.localStorage = { getItem: () => JSON.stringify({ environmentMode: 'invalid', simulatedYearMinutes: -10 }), setItem() {} }
  try {
    const settings = new Settings()
    assert.equal(settings.get('environmentMode'), 'off'); assert.equal(settings.get('simulatedYearMinutes'), 4)
    settings.set('environmentMode', 'manual'); settings.set('manualWeather', 'snow'); settings.applyPreset('low')
    assert.equal(settings.get('manualWeather'), 'snow'); assert.equal(settings.get('environmentMode'), 'manual')
    settings.applyAll({ environmentMode: 'actual', weatherLocation: {}, exposure: 1.2 })
    assert.equal(settings.get('environmentMode'), 'manual')
    let world
    settings.onChange((_,scope) => { world = scope.world })
    settings.set('manualWeather', 'rain'); assert.equal(world, false)
    settings.flush()
  } finally { globalThis.localStorage = prior }
})
