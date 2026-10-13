---
title: Weather and Seasons
status: active
created: 2026-10-11
updated: 2026-10-11
tags:
  - visualization
  - weather
  - seasons
related_decisions:
  - docs/decisions/2026-10-11-opt-in-weather-through-fixed-open-meteo-endpoints.md
---

# Weather and Seasons

## Intent

Make the colony feel alive through changing seasons and weather, with options analogous to the existing time controls. Earthlike weather is available on every planet: rain and snow do not become dust storms or other planet-specific substitutes.

## Users

Developers using Moon Base who want a changing environment or a connection to conditions outside.

## Current Behavior

World presets define ambient effects, including snow on Frost, leaves on Harvest, petals on Blossom, and dust on Mars. The sky supports drifting clouds and fixed, simulated, or local-clock time of day. The five modes below are implemented, including the Open-Meteo connection, browser cache, and fixed-host local server routes. The approved implementation plan defines the request and rendering details.

## Key Flows

1. The user chooses simulated cycle, live seasonal, or live actual for the environment.
2. Simulated cycle advances seasons and weather within the colony.
3. Live seasonal follows the date in the saved city's timezone and its hemisphere, with simulated weather appropriate to that season.
4. Live actual follows current conditions for that same saved city through a weather API. The recommended provider, Open-Meteo, supplies model-derived current conditions rather than direct station observations.
5. The selected weather applies on any planet, including Luna and Mars, using Earthlike effects.
6. The user can instead choose a fixed manual season and weather, or turn the feature off. Environment controls are independent of time of day.

## Acceptance Criteria

### WS-001 — Three modes (WS1)

The environment offers simulated cycle, live seasonal, and live actual options.

### WS-002 — Simulated cycle (WS2)

Seasons and weather change over simulated time at an adjustable speed without requiring a weather API. The cycle advances while Moon Base is actively rendering, pauses while hidden or closed, and resumes from its saved position without catching up after sleep.

### WS-003 — Live seasonal (WS3)

Seasons follow the saved city's calendar and hemisphere rather than the simulated cycle. Weather varies within that season without fetching current weather. After location setup, this mode works offline.

### WS-004 — Live actual (WS4)

Weather comes from a weather API for the selected location. When a refresh fails, the last valid conditions for that location remain visible, with their update time and an offline/stale indication. Without a saved reading, the UI says weather is unavailable rather than inventing current conditions.

### WS-005 — All planets (WS5)

Earthlike conditions apply on every planet. For example, actual rain can appear on Mars, and snow can appear on Luna, without translation into another effect.

### WS-006 — Location (WS6)

A saved city is shared by both live modes, including coordinates and timezone. Optional device location is requested only through an explicit button; denial leaves city selection usable. Changing cities never presents the previous city's reading as the new city's weather.

### WS-007 — Independent controls (WS7)

Changing time of day does not change the season/weather mode, and changing environment mode does not change time of day. Manual and off choices are available and persist across reloads.

### WS-008 — Readable and bounded effects (WS8)

Seasonal palette changes and weather transitions preserve the world's identity and keep bots and status badges readable. Existing particle, cloud, quality, reduced-motion, and audio settings remain effective.

Snowfall is visibly heavier than ambient drifting motes. While snow falls, patchy white cover builds on terrain and grass over roughly 20–30 active seconds. Cover fades after snow stops (faster in rain), pauses while hidden, and resets when the environment is Off or unavailable. This is a visual covering; it does not change terrain geometry, navigation or water. Cover is transient and does not persist across reloads.

### WS-009 — Explicit network boundary (WS9)

Only deliberate location setup and live actual weather require external requests. Disclose the provider and location information sent. Session contents, titles, IDs, repository paths, and colony layout never accompany these requests.


## Boundaries and Non-Goals

- Weather is an ambient feature; no changes to session status or work behavior are proposed.
- Physical realism does not restrict which planet can receive Earthlike weather.
- Live actual uses model-derived current weather; forecasts, station-only guarantees, physical snow depth, hail geometry, and lightning flashes are outside this feature.
- [Moon Base's spec](../moon-base/spec.md) and README document the narrow opt-in network exception. Session data remains local.

## Defaults and Conventions

The saved-city, adjustable active-only simulation, independent/manual/off controls, and cached offline behavior were accepted in discussion on 2026-10-11.

The following defaults were accepted with the implementation plan:

- Use meteorological seasons (three-month blocks beginning March, June, September, and December in the north, reversed in the south; latitude zero uses the north). This is a visual convention, not a local climate model.
- Live actual derives its season from the same city calendar; precipitation follows API conditions regardless of season.
- Start with off to preserve existing planet ambience and avoid network calls until a mode is chosen. Off disables these new overlays, not the preset's existing ambient effects.
- Simulated year: 60 active minutes by default, adjustable from 4 to 240 minutes. Save phase across reloads. Changing speed preserves phase.
- Initial conditions: clear, cloudy, fog, rain, snow, and storm. A storm has rain and darker clouds; lightning flashes and hail geometry are deferred. The user requested heavier snowfall and visible ground cover after the initial implementation.
- Device location can initially display as "My location" with its timezone; reverse geocoding is not required.

Provider and request design are in the [implementation plan](plan.md). Open-Meteo's free endpoint is for noncommercial use; commercial deployments need the paid endpoint and server-held key. Recheck suitability before live integration is enabled for a commercial deployment.

## Decision Links

- [Opt-in weather boundary](../../decisions/2026-10-11-opt-in-weather-through-fixed-open-meteo-endpoints.md)

- Related existing behavior and privacy boundary: [Moon Base](../moon-base/spec.md).
