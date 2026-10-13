---
title: Opt-in weather uses fixed Open-Meteo endpoints and keeps session data local
date: 2026-10-11
status: active
tags:
  - weather
  - privacy
  - architecture
related_specs:
  - docs/features/weather-seasons/spec.md
  - docs/features/moon-base/spec.md
supersedes: []
---

# Opt-in weather uses fixed Open-Meteo endpoints and keeps session data local

## Context

The user approved simulated, calendar-seasonal, and actual weather, including Earthlike weather on every planet. The existing application promised no external requests. Live weather requires a narrow exception, and the location and credentials need boundaries separate from session discovery.

## Decision

Use Open-Meteo through the existing local API middleware, with fixed HTTPS weather/geocoding hosts and server-held commercial credentials. Send only an explicit city query or coordinates plus fixed weather parameters, never session data. Default to original planet ambience. Keep the saved city, simulated phase, and bounded last-valid readings in browser storage rather than colony state. Share server caching, request deduplication, and retry cooldowns across tabs. Actual weather uses model-derived conditions and keeps timestamped cached weather on failure.

The free endpoint is for noncommercial use; commercial deployments require appropriate credentials. No purchase or provider account was created. This decision and the implementation plan were authorized by the user's approval on 2026-10-11.

## Consequences

Configured seasonal, simulated, manual, and off modes do not poll a provider. City setup is explicit, including the optional device-location button. The README and local-only acceptance criterion disclose the exception. Weather changes have no effect on sessions, status precedence, or colony topology. Each browser origin owns its environment settings; changing the server port does not copy a location from colony state.

## Alternatives Considered

- OpenWeather or WeatherAPI.com: viable, but their key requirement adds setup for the initial noncommercial use case.
- Direct browser-to-provider calls: simpler caching but repeats requests across tabs and would expose paid credentials.
- Planet-specific substitutes for rain or snow: rejected by the user; all worlds may have Earthlike weather.

## Links

- [Weather and seasons spec](../features/weather-seasons/spec.md)
- [Implementation plan and provider research](../features/weather-seasons/plan.md)
