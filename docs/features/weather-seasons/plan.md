---
status: completed
created: 2026-10-11
origin: docs/features/weather-seasons/spec.md
depth: deep
---

# Weather and Seasons Implementation Plan

## Problem and Scope

Add the accepted environment controls without entangling session discovery, colony layout, or the existing day/night clock. Deliver local simulation/manual controls and calendar seasons first, then API-backed weather. All worlds receive Earthlike effects.

This is a plan, not runtime implementation. The work spans rendering, settings, UI, and an external API, so use the repository's High-Risk/Cross-Cutting path when implementing: human review of spec/plan before code, followed by review and workflow compliance before any requested PR. No commit or PR is authorized by the planning request.

## Research and Provider Choice

Primary documentation checked on 2026-10-11. Recommendation: **Open-Meteo**, with one small provider-specific module rather than a multi-provider framework.

| Provider | Relevant offering | Decision |
| --- | --- | --- |
| Open-Meteo | Keyless noncommercial endpoint; current conditions are model-derived. City search supplies coordinates and timezone. | Best fit for a local app with minimal setup. |
| OpenWeather | Current weather and geocoding; API key required. Published free limit: 60 calls/minute, 1 million/month. | Viable alternative, but adds account/key setup. |
| WeatherAPI.com | Key required; free tier includes realtime weather and search, 100,000 calls/month. | Viable alternative; no compelling advantage for this scope. |

Sources: [Open-Meteo weather documentation](https://open-meteo.com/en/docs), [city search](https://open-meteo.com/en/docs/geocoding-api), [OpenWeather current weather](https://openweathermap.org/api/current), [OpenWeather pricing](https://openweathermap.org/price), [WeatherAPI pricing](https://www.weatherapi.com/pricing.aspx), [WeatherAPI authentication](https://www.weatherapi.com/docs/getting-started/).

Open-Meteo's free service permits noncommercial use, with limits of 600/minute, 5,000/hour, 10,000/day, and 300,000/month. Commercial use requires a subscription and customer endpoint. Data attribution is required under CC BY 4.0; city results also credit GeoNames. The free service has no uptime guarantee. Sources: [pricing](https://open-meteo.com/en/pricing), [terms](https://open-meteo.com/en/terms), [geocoding attribution](https://open-meteo.com/en/docs/geocoding-api#attribution). Do not assume workplace or commercial distribution qualifies for free access; verify the intended deployment before enabling it there. No subscription purchase is part of this plan.

The provider's current conditions approximate outside weather; they are not a station sensor feed. Keep the requested label "Live actual" and explain "Current weather from Open-Meteo" with the model-derived qualification in help text.

## Relevant Existing Patterns

- `src/core/settings.js`: flat localStorage settings, subscriptions, quality budgets, and scoped rebuilds. Environment choices must not be quality-preset keys or world-rebuild keys.
- `src/core/engine.js`: frame delta is capped and hidden-tab deltas are reset. It cannot serve as an accurate simulated-year clock at low frame rates; use a separate active elapsed clock with visibility handling.
- `src/game/colony.js`: owns world selection and per-frame updates, including `Particles.ambient`, sky, grass, and water. Apply environment state here without rebuilding terrain or navigation.
- `src/agents/particles.js`: shared bounded pools, preset weather table, ground-aware spawning; snow exists, rain does not. Weather currently reads the planet preset directly.
- `src/world/sky.js`: time-based fog/lighting, cloud uniforms, and throttled environment-map refresh. Weather must compose with time so `setTime` does not overwrite it.
- `src/world/grass.js`, `src/world/planet.js`, `src/audio/ambience.js`: vegetation, preset identity, ambient sounds. Use supported uniforms/material hooks, never mutate shared `PLANETS` objects.
- `src/ui/hud.js`, `src/main.js`, `src/game/api.js`: settings UI, wiring, request helpers.
- `server/api.mjs`: common API middleware for Vite and production, Host/Origin checks and guarded async handling. `test/support/with-server.mjs` supports route tests.
- `test/rendering.test.mjs`, `test/open-security.test.mjs`, `test/readonly-guard.test.mjs`: rendering and boundary checks to preserve.
- `docs/standards/index.yml` is empty; no additional enforceable standards apply. `docs/workflow/config.yml` selects acceptance-first tests, disables design hooks and E2E automation, and configures no reviewers.
- Follow `docs/learnings/2026-09-26-async-request-handlers-must-not-throw.md`, `docs/learnings/2026-09-26-check-added-ui-text-in-a-browser-not-only-in-a-test.md`, and `docs/learnings/2026-09-26-preview-designs-on-a-purpose-built-page.md`. `docs/solutions/` has no relevant entries. Existing architecture decisions retain local session processing and reuse of the renderer.

## Decisions and Assumptions

1. One `environmentMode` enum: `off`, `manual`, `simulated`, `seasonal`, `actual`. Default off preserves current ambience. Store manual season/condition, simulation phase/year duration, and saved location separately from the existing clock settings. Confirmed defaults and remaining visual conventions are explicit in the spec.
2. A small pure environment model computes season and target weather; a controller owns active simulation time, transitions, and live refreshes. Inject time, random seed, and fetch for deterministic tests. Avoid an event bus or provider registry.
3. Saved city includes label, latitude, longitude, and IANA timezone. Use the selected city's civil date for both live modes, not the machine's month or a fixed UTC offset. Northern meteorological seasons reverse in the south; exactly zero latitude uses north. The convention is decorative and may not match tropical climates.
4. Simulated year defaults to 60 active minutes (4–240 range). Weather targets change every 2–5 active minutes, weighted by season. Start a new cycle in spring; speed changes preserve phase. Persist phase on visibility/page exit plus at most once every 30 active seconds. Resume without closed/hidden/sleep catch-up. Detect long frame gaps and pause rather than count sleep; ordinary low-FPS frames must still count actual active elapsed time.
5. Off restores planet ambience. In other modes replace preset meteorological particles (dust, sand, ash, snow, leaves, petals, pollen) with resolved weather/season effects; retain independent fauna-like fireflies and sea spray/embers appropriate to the world. Define this categorization centrally and test it to avoid snow plus rain or residual Mars dust under clear weather. Seasonal tint is a restrained overlay on each world's palette; vegetation changes affect only vegetation already present.
6. Interpolate weather/cloud/fog targets over about 10 active seconds. Use season progress for gradual palette changes. Particle-off stops precipitation rendering; cloud-off stops rendered clouds; these options do not alter the chosen logical weather or status. Reserve particle capacity for work sparks/status feedback. Reduced motion removes unnecessary movement and no lightning flashes are introduced.
7. Fetch through the local server, sharing caching across tabs and keeping paid keys out of browser storage. Use Node's existing fetch, with fixed HTTPS destinations, no SDK. Paid configuration is a server environment option; never silently fall back to the free endpoint when paid authentication fails.
8. Browser localStorage holds location, settings, and a versioned last-valid reading keyed by location. Server caches are memory-only and bounded. Do not alter `data/colony.json` or the session scanner.

## Data and API Contracts

New local endpoints live within `apiMiddleware` and its existing security guard:

- `GET /api/weather/locations?q=...`: explicit submitted city search, 2–100 trimmed characters, at most five results. Normalize label/admin area/country, coordinates, and validated timezone. An empty list is a valid result. Display provider strings as text, never HTML.
- `GET /api/weather/current?latitude=...&longitude=...`: require finite coordinates in valid ranges, reject duplicates/arrays and arbitrary provider/URL parameters. Return normalized data with `locationKey`, `condition`, `intensity` (0–1), `temperatureC`, `cloudCover` (0–1), `windSpeedMs`, `windDirectionDeg`, `validAt`, `fetchedAt`, `stale`, and attribution. Timestamps are epoch milliseconds. Do not accept a session ID, repo path, or raw outbound URL.

Provider calls use fixed endpoints `https://geocoding-api.open-meteo.com/v1/search` and `https://api.open-meteo.com/v1/forecast`. For weather request only `current=temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m`, with `wind_speed_unit=ms`, `temperature_unit=celsius`, `timeformat=unixtime`, and `timezone=auto`. Device-location setup can reuse the current endpoint with an explicit setup intent to obtain the resolved timezone once; return that validated timezone as metadata. City search already supplies it. Source: [request and response documentation](https://open-meteo.com/en/docs). Ignore provider day/night fields so the existing sky clock remains independent.

Internal condition mapping: 0–1 clear; 2–3 cloudy; 45/48 fog; drizzle/rain/showers 51/53/55/56/57/61/63/65/66/67/80/81/82 rain; snow 71/73/75/77/85/86 snow; storms 95/96/97/99 storm. Preserve detail for a human-readable description; initial storm rendering uses rain/clouds, including hail-bearing reports. Unknown codes become unavailable, never clear. Intensity is a bounded visual interpretation, not a meteorological measurement. Validate required fields and timestamp sanity before cache adoption.

At integration time verify the paid weather/geocoding customer hostnames and credential parameter against the provider docs; allow only the two explicit configured host pairs, not arbitrary server URLs. Suggested server variables: `MOON_BASE_WEATHER_TIER=free|commercial` and `MOON_BASE_WEATHER_API_KEY`. Missing commercial credentials produce a fixed setup error.

### Refresh, Caching, and Failure Behavior

- Refresh actual weather on activation, then every 15 minutes while visible in actual mode. Server fresh-cache TTL: 15 minutes, coalesce concurrent requests by location, and cap weather entries at 32. One continuously active city costs about 96 requests/day before failures; this is a design estimate, not a provider guarantee.
- Search only on submit, cache queries for 24 hours (maximum 64 entries), rate-limit submissions, and reuse selected-city metadata offline. Seasonal mode never polls current weather after setup. No automatic geolocation or IP lookup.
- Bound upstream timeout at 8 seconds and response body at 256 KiB; reject redirects and unexpected/non-JSON bodies. Redact credentials and location from diagnostic logs. Always catch failures and return fixed local errors.
- On failure retain the matching last-valid reading and original `validAt`/`fetchedAt`; never advance those timestamps on a failed refresh. Mark stale if the reading's valid time is older than 30 minutes, or a refresh has failed. Show both "Conditions at" and "Checked" in detail to distinguish old model data from fetch time. Cached age continues to grow offline.
- Retry after 1, 5, then 15 minutes with jitter; honor a bounded Retry-After for 429. Share cooldown/backoff on the server so multiple tabs cannot multiply retries. Pause browser polling when hidden or in another mode; on return perform one cache-aware refresh.
- No cache for the city: show "Weather unavailable" with a neutral clear visual baseline, explicitly not a current-weather claim. Restore matching persisted cache on reload; discard invalid or mismatched cache. Changing city/mode aborts requests or ignores late responses by generation and location key.
- Device location is optional, requested by an explicit button, rounded to about city-scale coordinates (two decimal places), and saved as "My location". Denial/timeout leaves the saved city unchanged. Resolve timezone once during setup; if that fails do not adopt incomplete location data. Do not track movement.

## Requirements Traceability

| Spec | Implementation units | Evidence |
| --- | --- | --- |
| WS1, WS2 | U1, U3 | Mode/settings and fake-clock simulation tests; browser speed/pause checks |
| WS3 | U1, U4 | Calendar boundaries, hemispheres, selected-city timezone; offline seasonal check |
| WS4 | U4, U5 | API normalization/cache/backoff tests; offline/reload/freshness UI checks |
| WS5 | U2, U5 | Earthlike weather on Luna/Mars; every preset smoke check |
| WS6 | U3, U4, U5 | Search selection, location denial, city-change races, cache isolation |
| WS7 | U1, U3 | Time independence and persistence checks |
| WS8 | U2, U5 | Quality budgets and real browser readability/performance checks |
| WS9 | U4, U5 | Fixed-host and outbound-data tests; privacy copy reconciliation |

## Implementation Units

### U1. Environment Model and Persistence

Goal: make all modes deterministic and independent of rendering and network access.

- Add `src/world/environment.js` for pure season/date, seeded weather selection, mode resolution, and phase logic; add `src/game/environment-controller.js` for lifecycle handling. Extend `src/core/settings.js` with validated environment fields and conservative migration defaults. No new dependencies.
- Add `test/environment.test.mjs` and `test/environment-settings.test.mjs`: all modes; month/year boundaries and leap day; north/south/equator; timezone crossing midnight and DST; deterministic weather sequences; speed changes; active/hidden/reload/sleep behavior; low-FPS elapsed time; corrupt saved state; quality presets preserve environment settings; changing sky time leaves environment untouched.
- Dependency: none. Verify with targeted Node tests. Finalize visual weights and exact intensity clamp constants in this unit, documented alongside data rather than spread across renderer branches.

### U2. Render Weather and Seasons on Every Planet

Goal: add effects through existing bounded rendering paths without world rebuilds.

- Update `src/game/colony.js`, `src/agents/particles.js`, `src/world/sky.js`, `src/world/grass.js`, and relevant terrain/scatter material hooks in `src/world/planet.js`. Reuse palette uniforms where available; add minimal tint hooks where absent. Add rain to the particle shader/pool with a streak shape so it reads differently from snow. Blend fog/cloud/lighting after base sky evaluation; allow weather clouds on Luna despite its airless preset. No terrain height, collision, navigation, layout, or shared-preset mutation.
- Add `test/weather-render-state.test.mjs`; extend `test/rendering.test.mjs`: effect resolution on Luna/Mars and all presets, off restores baseline, no conflicting preset precipitation, rain/snow render flags differ, tint and cloud state survive time changes, ground-aware spawn, particle-off/cloud-off, finite interpolation, repeated planet switches, teardown/disposal and no terrain rebuild on ordinary transitions. Keep GPU appearance assertions manual.
- Manual evidence: fixed views of clear/rain/snow/fog/storm and four seasonal palettes on Terra, Luna, Mars, Frost, and Cinder; remaining presets smoke checked. Confirm readable badges by day/night at low/balanced quality. Capture before/after frame time and draw calls on the same fixture; ensure particle caps hold and recurring transitions do not accumulate GPU resources.
- Dependency: U1. Rain/snow sound design is deferred; existing audio settings remain unchanged.

### U3. Local Controls and Simulated Cycle

Goal: deliver useful weather without external services.

- Update `src/ui/hud.js`, `src/ui/styles.css`, and `src/main.js`: an Environment group with mode, manual season/condition, simulated-year duration, current season/weather summary, and shared saved-location affordance. Wire controller lifecycle, persistence, and rendering once. Actual mode remains visibly unavailable until U4; seasonal mode requires a resolved city, supplied by U4 rather than silently using the machine location.
- Add `test/environment-controller.test.mjs`: mode switching, pause/resume, persistence throttling, manual/off resolution, logical weather survives quality changes, clock independence, and disposal removes listeners/timers.
- Manual checks: keyboard selection, narrow panel and small viewport, no overlap with existing time controls, reload choices, manual weather on Mars, off restoration, reduced motion, and simulation speed changes. Preview real effects in a fixed-camera fixture if comparison is needed; this is verification of implemented behavior, not a separate exploratory prototype.
- Dependencies: U1/U2. This is the first delivery boundary: simulated/manual/off modes work locally.

### U4. Location and Open-Meteo Integration

Goal: implement the fixed-host service and activate both live modes.

- Add `server/weather.mjs`; update `server/api.mjs` and `src/game/api.js`; keep weather fetches separate from thread polling. Add city-search/device-location UI in `src/ui/hud.js`, and controller refresh logic in `src/game/environment-controller.js`. Use identical middleware under Vite and the production server.
- Add `test/weather-provider.test.mjs`: fixture normalization for every code group including code 97; null/unknown/invalid data; correct units/timestamps; endpoint allowlist; timeout/oversize/redirect/malformed JSON; free vs commercial configuration and no key leakage; no unrelated/session fields outbound.
- Add `test/weather-api.test.mjs` using isolated server fixtures: Host/Origin rejection, bad/nonfinite/duplicate coordinates, bounded query/results, empty search, cache expiry/LRU, concurrent deduplication, shared backoff and rate limits, 429 Retry-After, provider outage, fixed error text, and continued server availability after failures. Inject fake fetch and clock; default tests must not contact the provider.
- Extend `test/environment-controller.test.mjs`: city timezone adoption, missing city/setup state, manual search results, device permission denial, stale-cache reload, distinct valid/fetch times, no-cache unavailable, hidden-tab polling pause, no seasonal polling, late response after city or mode change, canceled work after disposal, and no background geolocation.
- Dependencies: U1/U3. Update privacy copy in the UI before enabling searches/weather requests: city query or coordinates and request metadata reach the provider; session data does not. Include Open-Meteo and GeoNames credit links where their data appears.

### U5. Integration, Documentation, and Delivery Verification

Goal: prove the accepted behaviors together and make the network exception explicit.

- Update `README.md` with modes, location setup, free/commercial setup, attribution, offline semantics, and disclosure. Update `docs/features/moon-base/spec.md` AC4 with the narrow opt-in weather/location exception; clarify browser local settings/cache separately from colony file writes in AC3. Keep `docs/features/weather-seasons/spec.md` current, with built behavior distinguished from remaining assumptions. Do not rewrite immutable historical decisions.
- Extend `test/readonly-guard.test.mjs` for no session writes/data export; run `test/open-security.test.mjs` and existing rendering checks. Add acceptance trace markers to requirement-linked tests using the repo helper.
- Manual end-to-end matrix: select a city; use seasonal mode offline; actual refresh success; disable network, reload, retain timestamped matching cache; change city during an in-flight request; missing cache; resume from sleep; paid-key failure; switch every planet while raining; independent live/simulated/manual sky time; quality/cloud/particle/audio/reduced-motion changes.
- Provider smoke check is opt-in and run once against a public city after mocked tests; verify response schema and attribution without using personal location or session data. Verify both `npm run dev` and built serving routes.
- Run targeted tests first, then `npm test` and `npm run build` for this cross-module change. Run configured review and workflow compliance before any user-requested commit/PR. Record browser evidence and unresolved provider issues explicitly; do not count HTTP success as visual verification.
- Dependencies: U2/U3/U4. This is the second delivery boundary: seasonal and actual modes enabled with accurate status and disclosure.

## Risks, Review, and Handoff

- Free endpoint suitability depends on intended use; paid configuration must be verified before commercial operation. If unresolved, ship local modes and keep actual unavailable for that deployment.
- Seasonal tints across unusual worlds may need visual tuning, especially snow on Frost and storms on Cinder. Keep changes bounded to materials and weather so plot picking and terrain stay stable.
- Selected-city calendar conventions are intentionally simple; regional wet/dry seasons and climate-specific distributions are deferred.
- Long frame gaps cannot perfectly distinguish sleep from a stalled renderer; document and test a conservative pause threshold instead of using the engine's capped delta or catching up hours of weather.
- Optional device location depends on browser permission and availability. Manual city search is the supported fallback.
- Human review is required before implementation by the repository's cross-cutting rule. No reviewers are configured and no review request has been sent. This completed plan is the review artifact; it contains no production changes.

Deferred: station-observation-only guarantees, multiple providers, forecasts/history, location tracking/reverse geocoding, lightning flashes, hail geometry, accumulation/puddles, dynamic rain audio, astronomy-based seasons, and climate zones.

Next step: review this plan and its explicit assumptions, then `aw-work docs/features/weather-seasons/plan.md` after human acceptance. Do not create tickets, purchase API access, commit, push, or open a PR without a separate request.
