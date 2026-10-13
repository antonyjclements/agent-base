import test from 'node:test'
import assert from 'node:assert/strict'
import { createWeatherService } from '../server/weather.mjs'
const instant = Date.parse('2026-10-11T12:00:00Z')
function data(code = 63) { return { timezone: 'America/New_York', current: { weather_code: code, temperature_2m: 15, precipitation: 0.2, cloud_cover: 90, wind_speed_10m: 3, wind_direction_10m: 180, time: instant / 1000 }, current_units: { temperature_2m: '°C', wind_speed_10m: 'm/s', precipitation: 'mm', time: 'unixtime' } } }
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
// @spec:WS-004, WS-009
test('WS4/WS9: normalized units, fixed hosts, shared cache and deduplicated requests', async () => {
  let calls = 0, url, opts
  const service = createWeatherService({ now: () => instant, env: {}, fetcher: async (u,o) => { calls++; url = u; opts = o; return response(data()) } })
  const [a,b] = await Promise.all([service.current(40,-70),service.current(40,-70)])
  assert.deepEqual(a,b); assert.equal(calls,1); await service.current(40,-70); assert.equal(calls,1)
  assert.equal(a.condition,'rain'); assert.equal(a.cloudCover,0.9); assert.equal(a.validAt,instant)
  assert.equal(url.origin,'https://api.open-meteo.com'); assert.equal(opts.redirect,'error')
  assert.deepEqual([...url.searchParams.keys()].sort(), ['latitude','longitude','current','wind_speed_unit','temperature_unit','timeformat','timezone'].sort())
})
// @spec:WS-004
test('WS4: stale failure preserves data and shares retry cooldown across callers', async () => {
  let clock = instant, calls = 0
  const service = createWeatherService({ now: () => clock, env: {}, random: () => 0, fetcher: async () => { if (++calls > 1) throw new Error('private upstream failure'); return response(data()) } })
  const first = await service.current(40,-70); clock += 16*60000
  const stale = await service.current(40,-70); assert.equal(stale.stale,true); assert.equal(stale.fetchedAt, first.fetchedAt)
  await service.current(40,-70); assert.equal(calls,2)
  clock += 60001; await service.current(40,-70); assert.equal(calls,3)
})
// @spec:WS-004
test('WS4: invalid code, nulls, timestamps, units, JSON, body sizes, and redirects fail closed', async () => {
  const invalid = [ { ...data(), current: { ...data().current, weather_code: 123 } }, { ...data(), current: { ...data().current, precipitation: null } }, { ...data(), current: { ...data().current, time: instant/1000 + 1000 } }, { ...data(), current_units: {} } ]
  for (const value of invalid) await assert.rejects(createWeatherService({ now: () => instant, env: {}, fetcher: async () => response(value) }).current(1,2), /invalid data/)
  for (const res of [new Response('not json'), new Response('{', { headers: { 'content-type': 'application/json' } }),new Response('x'.repeat(262145), { headers: { 'content-type': 'application/json' } }), new Response('', { status: 302 })]) {
    await assert.rejects(createWeatherService({ env: {}, fetcher: async () => res }).current(1,2))
  }
})
// @spec:WS-004
test('WS4: unknown conditions and storms including code 97 are mapped', async () => {
  const service = createWeatherService({ now: () => instant, env: {}, fetcher: async () => response(data(97)) })
  assert.equal((await service.current(1,2)).condition, 'storm')
})
// @spec:WS-006
test('WS6: explicit city search validates and bounds data, caches results, rate limits submissions', async () => {
  let calls = 0
  const service = createWeatherService({ now: () => instant, env: {}, fetcher: async url => { calls++; assert.equal(url.hostname,'geocoding-api.open-meteo.com'); return response({ results: [{ name: 'City', country: 'Country', latitude: 1, longitude: 2, timezone: 'UTC' }, { name: 'Bad', latitude: 999, longitude: 2, timezone: 'UTC' }] }) } })
  const cities = await service.locations('City'); assert.equal(cities.length,1); assert.equal(cities[0].label,'City, Country')
  await service.locations('City'); assert.equal(calls,1)
  await assert.rejects(service.locations('Elsewhere'), /wait/)
  await assert.rejects(service.locations('a'), /between/)
})
// @spec:WS-009
test('WS9: paid keys stay server-side and authentication failure never switches hosts', async () => {
  await assert.rejects(createWeatherService({ env: { MOON_BASE_WEATHER_TIER: 'commercial' } }).current(1,2), /server API key/)
  let calls = 0
  const service = createWeatherService({ env: { MOON_BASE_WEATHER_TIER: 'commercial', MOON_BASE_WEATHER_API_KEY: 'test-key' }, fetcher: async url => { calls++; assert.equal(url.hostname,'customer-api.open-meteo.com'); assert.equal(url.searchParams.get('apikey'),'test-key'); return new Response('', { status: 401 }) } })
  await assert.rejects(service.current(1,2), /unavailable/); assert.equal(calls,1)
})
// @spec:WS-004
test('WS4: timeout and Retry-After are bounded and do not repeatedly call upstream', async () => {
  let calls = 0
  const service = createWeatherService({ now: () => instant, env: {}, fetcher: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '1000000' } }) } })
  await assert.rejects(service.current(1,2), e => e.retryAfter === 3600000)
  await assert.rejects(service.current(1,2)); assert.equal(calls,1)
  const slow = createWeatherService({ env: {}, timeoutMs: 5, fetcher: async (_, { signal }) => new Promise((_,reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) })
  await assert.rejects(slow.current(1,2), /unavailable/)
})

// @spec:WS-004
test('WS4: request caches are bounded and failures can recover after synchronous setup errors', async () => {
  let clock = instant, calls = 0
  const env = { MOON_BASE_WEATHER_TIER: 'commercial' }
  const service = createWeatherService({ now: () => clock, env, random: () => 0, fetcher: async () => { calls++; return response(data()) } })
  await assert.rejects(service.current(1,2), /server API key/)
  env.MOON_BASE_WEATHER_API_KEY = 'test'; clock += 60001
  await service.current(1,2); assert.equal(calls,1)
  for (let i=0;i<33;i++) await service.current(2,i)
  await service.current(1,2); assert.equal(calls,35)
})
