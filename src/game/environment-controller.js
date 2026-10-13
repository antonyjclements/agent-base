import { SEASONS, calendarSeason, seasonalWeather, weatherVisual, locationKey, validReading } from '../world/environment.js'

const CACHE_KEY = 'moonbase.weather.v1'
const MINUTE = 60000
/** Owns active time and requests; it never reads a session or colony record. */
// @spec WS-002, WS-003, WS-004, WS-006, WS-007
export class EnvironmentController {
  constructor(settings, { current, now = Date.now, monotonic = () => performance.now(), document: doc = globalThis.document,
    window: win = globalThis.window, storage = globalThis.localStorage, onChange = () => {} } = {}) {
    Object.assign(this, { settings, current, now, monotonic, doc, win, storage, onChange })
    this.phase = settings.get('simulatedPhase')
    this.active = 0; this.savedAt = 0; this.generation = 0; this.nextRefresh = 0
    this.lastTick = monotonic(); this.failed = false; this.disposed = false
    this.cache = {}
    try { const saved = JSON.parse(storage?.getItem(CACHE_KEY) || '{}'); if (saved.version === 1 && saved.readings && typeof saved.readings === 'object' && !Array.isArray(saved.readings)) this.cache = Object.fromEntries(Object.entries(saved.readings).filter(([key, value]) => validReading(value, key, now())).sort((a,b) => a[1].fetchedAt - b[1].fetchedAt).slice(-8)) } catch { /* unavailable storage */ }
    this.state = { enabled: false, cloud: 0, fog: 0, dark: 0, precipitation: 0, snowCover: 0, season: 'spring', seasonProgress: 0, condition: 'clear' }
    this.visibility = () => {
      this.lastTick = monotonic(); this.persist()
      if (!doc?.hidden) this.nextRefresh = 0
    }
    this.exit = () => this.persist()
    doc?.addEventListener('visibilitychange', this.visibility)
    win?.addEventListener('pagehide', this.exit)
    this.unsubscribe = settings.onChange(changed => {
      if (changed.has('environmentMode') || changed.has('weatherLocation')) {
        this.generation++; this.abort?.abort(); this.pending = false; this.nextRefresh = 0; this.failed = false
      }
      if (changed.has('simulatedPhase')) this.phase = settings.get('simulatedPhase')
    })
  }
  persist() {
    this.settings.set('simulatedPhase', this.phase)
    // pagehide cannot rely on the debounced settings save.
    this.settings.flush?.()
  }
  async refresh() {
    const location = this.settings.get('weatherLocation')
    if (!location || !this.current || this.pending || this.disposed) return
    this.pending = true
    const generation = this.generation, key = locationKey(location)
    this.abort = new AbortController()
    try {
      const reading = await this.current(location, this.abort.signal)
      if (generation !== this.generation || this.disposed) return
      if (!validReading(reading, key, this.now())) throw new Error('Invalid weather reading')
      this.cache[key] = reading
      const keys = Object.keys(this.cache).sort((a,b) => this.cache[a].fetchedAt - this.cache[b].fetchedAt)
      while (keys.length > 8) delete this.cache[keys.shift()]
      try { this.storage?.setItem(CACHE_KEY, JSON.stringify({ version: 1, readings: this.cache })) } catch { /* bounded in memory */ }
      this.failed = Boolean(reading.stale)
      this.nextRefresh = Math.max(this.now() + MINUTE, Math.min(this.now() + 15 * MINUTE, reading.retryAt || this.now() + 15 * MINUTE))
    } catch (err) {
      if (generation !== this.generation || this.disposed) return
      this.failed = true
      this.nextRefresh = this.now() + Math.max(MINUTE, Math.min(3600000, err.retryAfter || MINUTE))
    } finally { if (generation === this.generation) this.pending = false }
  }
  update() {
    if (this.disposed) return this.state
    const time = this.monotonic(), gap = (time - this.lastTick) / 1000
    this.lastTick = time
    // A gap over five seconds is treated as a pause/sleep, not catch-up.
    const dt = !this.doc?.hidden && gap >= 0 && gap <= 5 ? gap : 0
    this.active += dt
    const mode = this.settings.get('environmentMode'), location = this.settings.get('weatherLocation')
    let season = this.settings.get('manualSeason'), progress = 0, condition = this.settings.get('manualWeather'), reading = null
    if (mode === 'simulated') {
      this.phase = (this.phase + dt / (this.settings.get('simulatedYearMinutes') * 60)) % 1
      season = SEASONS[Math.floor(this.phase * 4)]; progress = this.phase * 4 % 1
      condition = seasonalWeather(season, Math.floor(this.phase * this.settings.get('simulatedYearMinutes') * 60 / 180))
      if (this.active - this.savedAt >= 30) { this.savedAt = this.active; this.persist() }
    }
    if ((mode === 'seasonal' || mode === 'actual') && location) {
      const calendarKey = `${locationKey(location)}:${location.timezone}:${Math.floor(this.now() / MINUTE)}`
      if (calendarKey !== this.calendarKey) { this.calendarKey = calendarKey; this.calendar = calendarSeason(this.now(), location) }
      season = this.calendar.season; progress = this.calendar.progress
      condition = seasonalWeather(season, Math.floor(this.active / 180))
      if (mode === 'actual') {
        const key = locationKey(location), candidate = this.cache[key]
        reading = validReading(candidate, key, this.now()) ? candidate : null
        condition = reading?.condition || 'clear'
        if (!this.doc?.hidden && this.now() >= this.nextRefresh) void this.refresh()
      }
    }
    const unavailable = ['seasonal','actual'].includes(mode) && (!location || (mode === 'actual' && !reading))
    const enabled = mode !== 'off' && !unavailable
    const target = weatherVisual(condition, reading?.intensity)
    if (reading) target.cloud = reading.cloudCover
    const blend = this.settings.get('reducedMotion') ? 1 : 1 - Math.exp(-dt / 3)
    for (const key of ['cloud','fog','dark','precipitation']) this.state[key] += ((enabled ? target[key] : 0) - this.state[key]) * blend
    // Visual cover follows active time, independent of the particle quality setting.
    // It is transient, so Off/unavailable restores the planet immediately.
    this.state.snowCover = !enabled ? 0 : condition === 'snow'
      ? Math.min(1, this.state.snowCover + dt * (0.02 + target.precipitation * 0.04))
      : Math.max(0, this.state.snowCover - dt / (['rain', 'storm'].includes(condition) ? 20 : 45))
    if (['rain','snow','storm'].includes(condition)) this.state.precipitationKind = condition === 'snow' ? 'snow' : 'rain'
    Object.assign(this.state, { enabled: mode !== 'off', unavailable, season, seasonProgress: progress, condition, reading,
      stale: Boolean(reading && (this.failed || reading.stale || this.now() - reading.validAt > 30 * MINUTE)), location, mode })
    this.onChange(this.state)
    return this.state
  }
  dispose() {
    this.persist(); this.disposed = true; this.generation++; this.abort?.abort()
    this.unsubscribe(); this.doc?.removeEventListener('visibilitychange', this.visibility); this.win?.removeEventListener('pagehide', this.exit)
  }
}
