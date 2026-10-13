import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarSeason, seasonalWeather, conditionForCode, ambientWeather, normalizeEnvironment, validLocation, locationKey } from '../src/world/environment.js'
import { PLANETS } from '../src/world/planet.js'

// @spec:WS-003
test('WS3: calendar seasons use city timezone and hemisphere, including leap day', () => {
  const city = { latitude: 40, timezone: 'America/New_York' }
  assert.equal(calendarSeason(Date.parse('2024-03-01T01:00:00Z'), city).season, 'winter')
  assert.equal(calendarSeason(Date.parse('2024-03-01T06:00:00Z'), city).season, 'spring')
  assert.equal(calendarSeason(Date.parse('2024-06-01T12:00:00Z'), { ...city, latitude: -40 }).season, 'winter')
  assert.equal(calendarSeason(Date.parse('2024-12-31T12:00:00Z'), city).season, 'winter')
  assert.equal(calendarSeason(Date.parse('2024-03-10T08:00:00Z'), city).season, 'spring')
  assert.equal(calendarSeason(Date.parse('2024-09-01T12:00:00Z'), { latitude: 0, timezone: 'UTC' }).season, 'autumn')
})
// @spec:WS-002
test('WS2: seasonal weather is stable, variable, and season appropriate', () => {
  assert.equal(seasonalWeather('spring', 10), seasonalWeather('spring', 10))
  const summer = Array.from({ length: 100 }, (_, i) => seasonalWeather('summer', i))
  assert.ok(new Set(summer).size > 1); assert.ok(!summer.includes('snow'))
})
// @spec:WS-004
test('WS4: provider codes cover freezing precipitation, hail storms, and unknown values', () => {
  for (const code of [51,53,55,56,57,61,63,65,66,67,80,81,82]) assert.equal(conditionForCode(code), 'rain')
  for (const code of [71,73,75,77,85,86]) assert.equal(conditionForCode(code), 'snow')
  for (const code of [95,96,97,99]) assert.equal(conditionForCode(code), 'storm')
  assert.equal(conditionForCode(123), null); assert.equal(conditionForCode(null), null)
})
// @spec:WS-005
test('WS5: rain and snow replace preset weather on every planet; off restores originals', () => {
  for (const planet of Object.values(PLANETS)) {
    for (const condition of ['rain', 'snow']) {
      const actual = ambientWeather(planet, { enabled: true, condition, season: 'winter', precipitation: 1 })
      assert.ok(actual.some(e => e.kind === condition), planet.id)
      assert.ok(!actual.some(e => ['dust', 'sand', 'ash'].includes(e.kind)), planet.id)
      assert.equal(actual.some(e => e.kind === (condition === 'rain' ? 'snow' : 'rain')), false)
    }
    assert.deepEqual(ambientWeather(planet, { enabled: false }), planet.weather || [])
  }
})
// @spec:WS-001, WS-006
test('WS1/WS6: invalid environment settings and location metadata are normalized', () => {
  assert.equal(normalizeEnvironment('environmentMode', 'evil'), 'off')
  assert.equal(normalizeEnvironment('simulatedPhase', NaN), 0)
  assert.equal(normalizeEnvironment('simulatedYearMinutes', Infinity), 60)
  assert.equal(normalizeEnvironment('simulatedYearMinutes', 1), 4)
  assert.equal(normalizeEnvironment('weatherLocation', { latitude: 500 }), null)
  assert.equal(validLocation({ label: 'City', latitude: 1, longitude: 2, timezone: 'not-a-timezone' }), false)
})

// @spec:WS-006
test('WS6: coordinates close to zero have one canonical cache key', () => {
  assert.equal(locationKey({ latitude: -0.00001, longitude: -0.00001 }), locationKey({ latitude: 0, longitude: 0 }))
})
