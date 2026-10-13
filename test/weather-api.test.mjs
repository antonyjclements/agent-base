import http from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { withServer } from './support/with-server.mjs'

// @spec:WS-009
test('WS9: weather routes validate parameters, preserve origin guards, and keep errors contained', async () => {
  await withServer(async ({ api, call, port }) => {
    let calls = 0
    api.setWeatherService({ current: async (lat,lon) => { calls++; assert.equal(lat,40); assert.equal(lon,-70); return { condition: 'rain' } }, locations: async () => [] })
    for (const query of ['latitude=&longitude=1', 'latitude=NaN&longitude=1', 'latitude=40&latitude=41&longitude=-70', 'latitude=40&longitude=-70&url=http://evil', 'latitude=40']) {
      assert.equal((await call('/api/weather/current?'+query)).status, 400)
    }
    assert.equal((await call('/api/weather/current?latitude=40&longitude=-70')).status, 200); assert.equal(calls,1)
    const cities = await call('/api/weather/locations?q=City'); assert.deepEqual(await cities.json(), { locations: [] })
    assert.equal((await call('/api/weather/locations?q=City', { headers: { Origin: 'https://evil.test' } })).status,403)
    assert.equal((await call('/api/weather/current?latitude=40&longitude=-70', { method: 'POST' })).status,405)
    api.setWeatherService({ current: async () => { throw new Error('secret upstream response') } })
    const failure = await call('/api/weather/current?latitude=40&longitude=-70')
    assert.equal(failure.status,502); assert.ok(!(await failure.text()).includes('secret'))
    assert.equal((await call('/api/identity')).status,200)
    const rebound = await new Promise((resolve,reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/api/weather/locations?q=City', headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error',reject)
    })
    assert.equal(rebound,403)
  })
})
