import { SEASONS, CONDITIONS, validLocation } from '../world/environment.js'
import { searchWeatherLocations, fetchWeather } from '../game/api.js'
const title = value => value[0].toUpperCase() + value.slice(1)

/** Plain DOM, like the rest of Settings. Provider text is never used as markup. */
// @spec WS-001, WS-006, WS-007
export function buildEnvironment(hud) {
  const box = document.createElement('section')
  box.className = 'group environment'
  const heading = document.createElement('h3'); heading.textContent = 'Weather & seasons'; box.append(heading)
  box.append(hud._select('Environment', 'environmentMode', [
    ['off', 'Off (planet ambience)'], ['manual', 'Manual'], ['simulated', 'Simulated cycle'], ['seasonal', 'Live seasonal'], ['actual', 'Live actual'],
  ]))
  const manual = document.createElement('div')
  manual.append(hud._select('Season', 'manualSeason', SEASONS.map(s => [s, title(s)])), hud._select('Weather', 'manualWeather', CONDITIONS.map(s => [s, title(s)])))
  for (const [index, label] of ['Environment mode', 'Season', 'Weather'].entries()) [...box.querySelectorAll('select'), ...manual.querySelectorAll('select')][index].setAttribute('aria-label', label)
  const speed = hud._slider('Simulated year', 'simulatedYearMinutes', 4, 240, 1, v => `${v} min`)
  const live = document.createElement('div'); live.className = 'environment-location'
  const city = document.createElement('p'); city.className = 'environment-note'
  const privacy = document.createElement('p'); privacy.className = 'environment-note'
  privacy.textContent = 'City searches send your query to Open-Meteo. Live actual sends city coordinates; session data stays local. Current conditions are model-derived. The free service is for noncommercial use.'
  const form = document.createElement('form'); form.className = 'environment-search'
  const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'City, region or country'; input.minLength = 2; input.maxLength = 100; input.required = true; input.setAttribute('aria-label', 'Weather city')
  const search = document.createElement('button'); search.type = 'submit'; search.textContent = 'Search'
  form.append(input, search)
  const results = document.createElement('div'); results.className = 'environment-results'
  const note = document.createElement('p'); note.className = 'environment-note'; note.setAttribute('role', 'status')
  let sequence = 0
  form.addEventListener('submit', async event => {
    event.preventDefault(); const ticket = ++sequence
    note.textContent = 'Searching…'; results.replaceChildren()
    try {
      const { locations } = await searchWeatherLocations(input.value.trim())
      if (ticket !== sequence) return
      note.textContent = locations.length ? 'Choose a city:' : 'No cities found. Try a region or country too.'
      for (const location of locations) {
        if (!validLocation(location)) continue
        const button = document.createElement('button'); button.type = 'button'; button.textContent = location.label
        button.addEventListener('click', () => { sequence++; hud.settings.set('weatherLocation', location); results.replaceChildren(); note.textContent = 'Location saved.' })
        results.append(button)
      }
    } catch (err) { if (ticket === sequence) note.textContent = err.message }
  })
  const locate = document.createElement('button'); locate.type = 'button'; locate.textContent = 'Use my location'
  locate.addEventListener('click', () => {
    const ticket = ++sequence
    if (!navigator.geolocation) { note.textContent = 'Location is unavailable. Choose a city instead.'; return }
    note.textContent = 'Requesting location…'; locate.disabled = true
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const coordinates = { latitude: Number(position.coords.latitude.toFixed(2)), longitude: Number(position.coords.longitude.toFixed(2)) }
        const weather = await fetchWeather(coordinates)
        const location = { ...coordinates, label: 'My location', timezone: weather.timezone }
        if (ticket !== sequence) return
        if (!validLocation(location)) throw new Error('Could not resolve location timezone. Choose a city instead.')
        hud.settings.set('weatherLocation', location); results.replaceChildren(); note.textContent = 'Location saved.'
      } catch { if (ticket === sequence) note.textContent = 'Could not resolve location. Choose a city instead.' }
      finally { locate.disabled = false }
    }, () => {
      locate.disabled = false
      if (ticket === sequence) note.textContent = 'Location was not available. You can choose a city instead.'
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 })
  })
  const credits = document.createElement('p'); credits.className = 'environment-note'
  for (const [label, url] of [['Weather: Open-Meteo (CC BY 4.0)', 'https://open-meteo.com/'], [' · Locations: GeoNames', 'https://www.geonames.org/']]) {
    const a = document.createElement('a'); a.textContent = label; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; credits.append(a)
  }
  live.append(city, privacy, form, results, locate, note, credits)
  const summary = document.createElement('p'); summary.className = 'environment-summary'; summary.setAttribute('role', 'status')
  box.append(manual, speed, live, summary)
  hud.controls.push({ sync: () => {
    const mode = hud.settings.get('environmentMode')
    manual.hidden = mode !== 'manual'; speed.hidden = mode !== 'simulated'; live.hidden = !['seasonal','actual'].includes(mode)
    city.textContent = hud.settings.get('weatherLocation')?.label || 'Choose a city to use either live mode.'
  } })
  let lastSummary = ''
  hud.setEnvironment = state => {
    const particles = hud.settings.get('particles'), clouds = hud.settings.get('clouds')
    const signature = [state.mode, state.unavailable, state.season, state.condition, state.stale, state.location?.label, state.location?.timezone, state.reading?.validAt, state.reading?.fetchedAt, state.reading?.temperatureC, particles, clouds].join(':')
    if (signature === lastSummary) return
    lastSummary = signature
    let text = state.mode === 'off' ? 'Using this planet’s original ambience.' : `${title(state.season)} · ${title(state.condition)}`
    if (state.unavailable) text = state.location ? 'Weather unavailable — showing a neutral sky.' : 'Choose a city to start.'
    if (state.mode === 'actual' && state.reading) {
      const time = value => new Date(value).toLocaleString(undefined, { timeZone: state.location.timezone })
      text += ` · ${Math.round(state.reading.temperatureC)}°C${state.stale ? ' · Offline / stale' : ''}\nConditions at ${time(state.reading.validAt)}\nChecked ${time(state.reading.fetchedAt)} (${state.location.timezone})`
    }
    if (state.mode !== 'off' && !state.unavailable) {
      if (particles === 'off' && ['rain', 'snow', 'storm'].includes(state.condition)) text += '\nRain and snow are hidden because Particles is Off. Choose Low or Full under Performance.'
      if (clouds === false && ['cloudy', 'rain', 'snow', 'storm'].includes(state.condition)) text += '\nClouds are hidden. Enable Clouds under Look.'
    }
    if (summary.textContent !== text) summary.textContent = text
  }
  return box
}
