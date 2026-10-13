# Weather and seasons verification

Verified against the approved [spec](spec.md) and [plan](plan.md). Implementation and visual follow-ups are complete. The user subsequently authorized a direct push to main.

The effective test policy is **acceptance-first**. The full suite passed all **554 tests**, with no failures or skips. The production build passed; its existing asset-extension and bundle-size warnings remain. `git diff --check` passed. Requirement tracing reported 10 requirements, 35 test anchors, 19 code anchors, and no errors or warnings (including the existing Moon Base requirement).

| Acceptance | Evidence |
| --- | --- |
| WS-001 modes | Settings/model tests; browser control selection |
| WS-002 simulated cycle | Fake-clock tests for active time, hidden tabs, sleep gaps, speed changes, phase persistence and reload |
| WS-003 live seasonal | Calendar boundary, hemisphere, timezone, DST and leap-day tests; controller proves no current-weather requests |
| WS-004 actual weather | Provider/controller tests for normalization, timestamps, cache/reload, unavailable state and refresh failures; real Open-Meteo request and browser timestamp/stale checks |
| WS-005 all planets | Preset meteorology tests and browser rain smoke check across all 12 worlds; visual review of Luna and Mars |
| WS-006 location | City/cache isolation and request-race tests; browser city selection and denied device-location check preserving the saved city |
| WS-007 independent controls | Settings/controller tests for persistence, quality independence and no world rebuild; browser mode/time controls |
| WS-008 bounded effects | Particle capacity, floor, disable/disposal, snow transition and grass-restoration tests; mobile 390-pixel layout check and sampled rain/snow visual review |
| WS-009 network boundary | Fixed-host, units, outbound parameter, credentials, Host/Origin, request-validation and failure-containment tests; README, UI disclosure and boundary decision updated |

The production server returned 200 for the built app and identity route, and 400 for malformed weather coordinates. Default automated tests use fixtures and do not contact the provider. A separate real free-endpoint smoke check returned valid city results and normalized current conditions.

Code review covered correctness, tests, project conventions, reuse, performance, API/security boundaries, error handling and frontend races. Review fixes included synchronous provider setup cleanup, bounded cache loading/LRU access, snow fade identity, preservation of work particles, and avoiding repeated calendar/status formatting per frame. No unresolved review findings remain. No applicable standards are registered. Design hooks and automated E2E are disabled in workflow configuration; browser checks supplemented the automated suite. The user approved the plan before implementation.

Workflow compliance passes for implementation delivery: living specs and feature index are current, acceptance coverage is mapped above, README documents setup and privacy, and the provider decision is recorded. No commit, push or PR was requested, so shipping steps are not applicable to this delivery.

Limitations: commercial configuration and missing-key failures were tested with fixtures; a live paid endpoint was not tested because no paid credentials were supplied. Visual checks sampled conditions rather than exhaustively reviewing every condition on every world. A short 16-frame CPU draw sample measured 4.54 ms off, 4.89 ms rain and 4.93 ms snow, with unchanged 669 draw calls and 381 geometries; this is a smoke measurement, not a GPU performance guarantee. Rain/snow audio, accumulation, hail geometry and lightning remain deferred as planned.

## Follow-up: effects difficult to see on Terra

The user reported that only fog appeared to work. Reproduction on Terra at Balanced quality showed that precipitation was emitted, but snow projected to roughly a pixel and rain's narrow soft core was easily lost in tilt-shift blur. Overhead clouds mostly sat outside the isometric view, and cloudy lighting changes were too weak. The initial visual smoke check did not adequately assess readability.

Precipitation now has a minimum projected size (5 pixels for snow, 18 for rain streak length), with a stronger rain core and denser bounded snowfall. A per-particle flag preserves the original sizing of sparks, dust and other effects. Overcast also changes the visible horizon, sun visibility and bounce lighting; disabling the overlay restores the original sky. Shared particle capacity and draw calls remain unchanged.

Verified rain, snow and settled clear/cloudy transitions on Terra with normal tilt-shift enabled. The summary now explains when Particles or Clouds is disabled; browser checks verified both messages. New regression coverage checks particle flag compaction, separation from work effects, visible horizon/bounce changes, and exact restoration without compounding. The full suite now passes **556 tests**, the build passes, and tracing reports 37 test anchors with no errors or warnings. Paid-endpoint and exhaustive visual-matrix limitations above still apply.

## Follow-up: heavier snowfall and ground cover

The user subsequently requested stronger snowfall and visible signs of snow on the ground, expanding the initial scope. Snowflakes now fall faster, have a firmer bright core and larger minimum projected size, and emit more densely within the same particle limits. Transient cover builds over roughly 20–30 active seconds, melts in roughly 45 active seconds after snow stops (20 in rain), and clears immediately for Off or unavailable conditions. Terrain uses a patchy shader overlay after vertex colours, with slope and waterline masks; grass roots and tips lighten too. It changes neither navigation nor geometry and does not survive a reload.

Acceptance-first regression checks cover accumulation, hidden/sleep pauses, bounded coverage, melting, unavailable/Off restoration, terrain uniform updates without geometry changes, preservation of floating-island clipping and grass colour restoration. Browser checks on Terra confirmed heavier flakes, white ground, melting (cover 1 to 0.978 after one second of clear weather) and Off restoration to 0. Luna, floating-island and shoreline shader smoke checks reported no failures. **558 tests pass**, the production build passes, `git diff --check` is clean, and requirement tracing reports 40 test anchors with no errors or warnings. README and the living spec reflect the added scope. No live paid-endpoint or full GPU benchmark was needed for this visual change.

## Main integration

Applied the weather commit on top of the current remote main, preserving its newer thread-title fix. Weather source files are unchanged from the previously reviewed implementation. The integrated suite passes **563 tests**, with no failures or skips; the production build, whitespace check and requirement tracing pass. Direct-main delivery was explicitly requested by the user. No PR or additional pipeline-monitoring skill is configured for this delivery.
