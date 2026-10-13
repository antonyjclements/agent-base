/** Pure environment rules shared by the browser and local weather service. */
export const SEASONS = ['spring', 'summer', 'autumn', 'winter']
export const CONDITIONS = ['clear', 'cloudy', 'fog', 'rain', 'snow', 'storm']
export const MODES = ['off', 'manual', 'simulated', 'seasonal', 'actual']
export const ENVIRONMENT_DEFAULTS = {
  environmentMode: 'off', manualSeason: 'spring', manualWeather: 'clear',
  simulatedYearMinutes: 60, simulatedPhase: 0, weatherLocation: null,
}
export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v))
export function validTimezone(value) {
  if (typeof value !== 'string' || value.length > 100) return false
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}
export function validLocation(value) {
  return Boolean(value && typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 200 &&
    Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 && validTimezone(value.timezone))
}
export function locationKey(location) {
  return `${Number(location.latitude.toFixed(4)).toFixed(4)},${Number(location.longitude.toFixed(4)).toFixed(4)}`
}
// @spec WS-001, WS-006, WS-007
export function normalizeEnvironment(key, value) {
  if (key === 'environmentMode') return MODES.includes(value) ? value : 'off'
  if (key === 'manualSeason') return SEASONS.includes(value) ? value : 'spring'
  if (key === 'manualWeather') return CONDITIONS.includes(value) ? value : 'clear'
  if (key === 'simulatedYearMinutes') return Number.isFinite(value) ? clamp(value, 4, 240) : 60
  if (key === 'simulatedPhase') return Number.isFinite(value) ? ((value % 1) + 1) % 1 : 0
  if (key === 'weatherLocation') return validLocation(value) ? {
    label: value.label, latitude: value.latitude, longitude: value.longitude, timezone: value.timezone,
  } : null
  return value
}
// @spec WS-003
export function calendarSeason(now, location) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: location.timezone, month: 'numeric', day: 'numeric' }).formatToParts(now)
  const month = Number(parts.find(p => p.type === 'month').value)
  const day = Number(parts.find(p => p.type === 'day').value)
  const index = ((Math.floor((month + 9) % 12 / 3)) + (location.latitude < 0 ? 2 : 0)) % 4
  return { season: SEASONS[index], progress: ((month + 9) % 3 + (day - 1) / 31) / 3 }
}
const WEIGHTS = {
  spring: ['clear', 'cloudy', 'rain', 'rain', 'fog'],
  summer: ['clear', 'clear', 'cloudy', 'rain', 'storm'],
  autumn: ['clear', 'cloudy', 'cloudy', 'rain', 'fog'],
  winter: ['clear', 'cloudy', 'fog', 'snow', 'snow'],
}
// @spec WS-002
export function seasonalWeather(season, slot) {
  // Stable per slot, so rendering frequency and reloads do not change the weather.
  const seed = Math.imul((slot | 0) ^ 0x45d9f3b, 0x45d9f3b) >>> 0
  return WEIGHTS[season][seed % WEIGHTS[season].length]
}
export function conditionForCode(code) {
  if ([0, 1].includes(code)) return 'clear'
  if ([2, 3].includes(code)) return 'cloudy'
  if ([45, 48].includes(code)) return 'fog'
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return 'rain'
  if ([71,73,75,77,85,86].includes(code)) return 'snow'
  if ([95,96,97,99].includes(code)) return 'storm'
  return null
}
export function validReading(value, key, now = Date.now()) {
  return Boolean(value && value.locationKey === key && CONDITIONS.includes(value.condition) &&
    ['intensity','temperatureC','cloudCover','windSpeedMs','windDirectionDeg','validAt','fetchedAt'].every(k => Number.isFinite(value[k])) &&
    value.intensity >= 0 && value.intensity <= 1 && value.cloudCover >= 0 && value.cloudCover <= 1 &&
    value.windSpeedMs >= 0 && value.windDirectionDeg >= 0 && value.windDirectionDeg <= 360 &&
    value.validAt > 0 && value.fetchedAt > 0 && value.validAt <= now + 300000 && value.fetchedAt <= now + 300000)
}
export function weatherVisual(condition, intensity = 0.6) {
  return {
    cloud: ({ clear: 0.1, cloudy: 0.75, fog: 0.8, rain: 0.85, snow: 0.7, storm: 1 })[condition] ?? 0.1,
    fog: condition === 'fog' ? 1 : condition === 'storm' ? 0.35 : 0,
    dark: condition === 'storm' ? 0.65 : condition === 'rain' ? 0.4 : condition === 'cloudy' ? 0.3 : condition === 'snow' ? 0.15 : 0,
    precipitation: ['rain', 'snow', 'storm'].includes(condition) ? clamp(intensity, 0.15, 1) : 0,
  }
}
// @spec WS-005, WS-008
export function ambientWeather(planet, environment) {
  if (!environment?.enabled) return planet.weather || (planet.dust ? [{ kind: 'dust', rate: planet.dust }] : [])
  const result = (planet.weather || []).filter(e => ['fireflies', 'spray', 'embers'].includes(e.kind))
  if (environment.precipitation > 0.01) result.push({ kind: environment.precipitationKind || (environment.condition === 'snow' ? 'snow' : 'rain'), rate: environment.precipitation * 2 })
  if (environment.season === 'spring' && planet.grass) result.push({ kind: 'petals', rate: 0.2 })
  if (environment.season === 'autumn' && planet.grass) result.push({ kind: 'leaves', rate: 0.3 })
  return result
}
