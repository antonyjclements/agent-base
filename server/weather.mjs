import { conditionForCode, clamp, locationKey, validTimezone } from '../src/world/environment.js'

const MINUTE = 60000
const TTL = 15 * MINUTE
const fail = (message, status = 502, retryAfter = 0) => Object.assign(new Error(message), { status, retryAfter })
function boundedSet(map, key, value, max) {
  map.delete(key)
  map.set(key, value)
  if (map.size > max) map.delete(map.keys().next().value)
}
/** A fixed-host provider. Injection keeps normal tests entirely offline. */
// @spec WS-004, WS-006, WS-009
export function createWeatherService({ fetcher = fetch, now = Date.now, random = Math.random, env = process.env, timeoutMs = 8000 } = {}) {
  const weather = new Map(), searches = new Map(), pending = new Map(), failures = new Map()
  let nextSearch = 0
  function endpoint(kind) {
    const tier = env.MOON_BASE_WEATHER_TIER || 'free'
    if (!['free', 'commercial'].includes(tier)) throw fail('Weather tier must be free or commercial', 503)
    if (tier === 'commercial' && !env.MOON_BASE_WEATHER_API_KEY) throw fail('Commercial weather requires a server API key', 503)
    const host = kind === 'search' ? 'geocoding-api.open-meteo.com' : 'api.open-meteo.com'
    const url = new URL(`https://${tier === 'commercial' ? 'customer-' : ''}${host}/v1/${kind === 'search' ? 'search' : 'forecast'}`)
    if (tier === 'commercial') url.searchParams.set('apikey', env.MOON_BASE_WEATHER_API_KEY)
    return url
  }
  async function upstream(url) {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    try {
      const res = await fetcher(url, { signal: abort.signal, redirect: 'error' })
      if (!res.ok) {
        const retry = Number(res.headers.get('retry-after'))
        const date = Date.parse(res.headers.get('retry-after') || '')
        const seconds = Number.isFinite(retry) && retry > 0 ? retry : Math.max(0, (date - now()) / 1000)
        throw fail('Weather provider is unavailable', 502, Number.isFinite(seconds) ? clamp(seconds, 0, 3600) * 1000 : 0)
      }
      if (!res.headers.get('content-type')?.includes('application/json')) throw fail('Weather provider returned invalid data')
      if (Number(res.headers.get('content-length')) > 262144) throw fail('Weather provider returned too much data')
      const reader = res.body.getReader()
      const chunks = []; let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 262144) throw fail('Weather provider returned too much data')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (err) {
      if (err.status) throw err
      throw fail('Weather provider is unavailable')
    } finally { clearTimeout(timer) }
  }
  async function current(latitude, longitude) {
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw fail('Invalid weather coordinates', 400)
    // Round requests too: one canonical location has one request/cache key.
    latitude = Number(latitude.toFixed(4)); longitude = Number(longitude.toFixed(4))
    const key = locationKey({ latitude, longitude })
    const cached = weather.get(key)
    const old = failures.get(key)
    const response = (reading, stale = false, retryAt = now() + TTL) => ({ ...reading, stale: stale || now() - reading.validAt > 30 * MINUTE, retryAt })
    if (cached && now() - cached.fetchedAt < TTL && !old) { boundedSet(weather, key, cached, 32); return response(cached) }
    if (old && now() < old.until) {
      if (cached) return response(cached, true, old.until)
      throw fail('Weather is unavailable; please try again later', 503, old.until - now())
    }
    if (pending.has(key)) return pending.get(key)
    if (pending.size >= 8) throw fail('Weather is busy; please try again shortly', 503, MINUTE)
    const task = Promise.resolve().then(async () => {
      try {
        const url = endpoint('weather')
        url.searchParams.set('latitude', String(latitude)); url.searchParams.set('longitude', String(longitude))
        url.searchParams.set('current', 'temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m')
        url.searchParams.set('wind_speed_unit', 'ms'); url.searchParams.set('temperature_unit', 'celsius')
        url.searchParams.set('timeformat', 'unixtime'); url.searchParams.set('timezone', 'auto')
        const data = await upstream(url), c = data.current, units = data.current_units
        const condition = conditionForCode(c?.weather_code)
        if (!condition || !validTimezone(data.timezone) || !c ||
          !['temperature_2m','cloud_cover','precipitation','wind_speed_10m','wind_direction_10m','time'].every(k => Number.isFinite(c[k])) ||
          c.cloud_cover < 0 || c.cloud_cover > 100 || c.precipitation < 0 || c.wind_speed_10m < 0 ||
          c.wind_direction_10m < 0 || c.wind_direction_10m > 360 || c.time <= 0 || c.time * 1000 > now() + 300000 ||
          units?.temperature_2m !== '°C' || units?.wind_speed_10m !== 'm/s' || units?.precipitation !== 'mm' || units?.time !== 'unixtime') throw fail('Weather provider returned invalid data')
        const reading = { locationKey: key, condition, weatherCode: c.weather_code, intensity: clamp(c.precipitation / 3, 0.2, 1),
          temperatureC: c.temperature_2m, cloudCover: c.cloud_cover / 100, windSpeedMs: c.wind_speed_10m,
          windDirectionDeg: c.wind_direction_10m, validAt: c.time * 1000, fetchedAt: now(), timezone: data.timezone,
          attribution: 'Weather: Open-Meteo (CC BY 4.0)' }
        boundedSet(weather, key, reading, 32); failures.delete(key)
        return response(reading)
      } catch (err) {
        const count = (old?.count || 0) + 1
        const delay = Math.max(err.retryAfter || 0, [1, 5, 15][Math.min(2, count - 1)] * MINUTE * (1 + random() * 0.1))
        boundedSet(failures, key, { count, until: now() + delay }, 32)
        if (cached) return response(cached, true, now() + delay)
        throw fail(err.message, err.status || 502, delay)
      } finally { pending.delete(key) }
    })
    pending.set(key, task)
    return task
  }
  async function locations(query) {
    if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 100) throw fail('Enter a city name between 2 and 100 characters', 400)
    query = query.trim()
    const key = `search:${query.toLowerCase()}`
    const cached = searches.get(key)
    if (cached && now() - cached.at < 86400000) { boundedSet(searches, key, cached, 64); return cached.value }
    if (pending.has(key)) return pending.get(key)
    if (pending.size >= 8) throw fail('Weather is busy; please try again shortly', 503, MINUTE)
    if (now() < nextSearch) throw fail('Please wait before searching again', 429, nextSearch - now())
    nextSearch = now() + 2000
    const task = Promise.resolve().then(async () => {
      try {
        const url = endpoint('search'); url.searchParams.set('name', query); url.searchParams.set('count', '5'); url.searchParams.set('language', 'en')
        const data = await upstream(url)
        if (data.results !== undefined && !Array.isArray(data.results)) throw fail('Weather provider returned invalid data')
        const value = (data.results || []).slice(0, 5).filter(r => typeof r.name === 'string' &&
          Number.isFinite(r.latitude) && Math.abs(r.latitude) <= 90 && Number.isFinite(r.longitude) && Math.abs(r.longitude) <= 180 && validTimezone(r.timezone))
          .map(r => ({ label: [r.name, r.admin1, r.country].filter(v => typeof v === 'string' && v).join(', ').slice(0, 200), latitude: r.latitude, longitude: r.longitude, timezone: r.timezone }))
        boundedSet(searches, key, { at: now(), value }, 64)
        return value
      } finally { pending.delete(key) }
    })
    pending.set(key, task)
    return task
  }
  return { current, locations }
}
