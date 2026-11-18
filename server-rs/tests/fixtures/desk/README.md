# Desk route parity fixtures

These bodies are the TypeScript desk-route output. `desk_parity::desk_routes_match_typescript_bytes` replays the recorded AWC and Open-Meteo files through the Rust routes and compares status, content type, cache-control, and body bytes. Tests do not open a live weather connection.

Recorded upstream files live in `tests/fixtures/recorded/awc/` and `tests/fixtures/recorded/sctb-gfs-seamless-2026-11-18.json`. They were captured on 2026-11-18. The SIGMET file is a subset of that day's feed (two Chile items plus one non-match), not a synthetic bulletin. EXAMPLE rows are the TypeScript mock envelopes used when the scripted upstream fails.

Night rows: live SCEL `180300Z` (00:00 CLST), the archived SCEL `170500Z` timeline, and the viz field built from those live METARs. Missing-field rows: SCEL CAVOK with an empty cloud list, the live SCTB TAF query that returned `[]`, and the recorded GFS body, which has no desk pressure-level series.

## Known deviations from TS

1. **Open-Meteo 200 that is not JSON.** `res.json()` throws in `fetchOpenMeteo`, and Next serves an HTML 500. Rust returns `502` `{"error":"Upstream unavailable","code":"bad-json"}` with `content-type: application/json` and no `cache-control`. The body does not include the serde message. Pinned by `desk_parity::invalid_open_meteo_json_is_502_json`.
2. **AWC 200 that is not JSON.** `fetchJson` catches the parse error and the TypeScript METAR/TAF routes return a mock envelope. Rust returns an observations-unavailable envelope (`source` `unavailable`, `data` null, code `awc-bad-json`) and does not include the serde message. A mock METAR or TAF is returned only when `WEATHER_DEV_MOCK=1`. Pinned by `desk_parity::invalid_awc_json_is_observations_unavailable` and `desk_parity::dev_mock_flag_returns_a_marked_metar_without_upstream_text`.

## MeteoChile WRF

`tests/fixtures/doc-shaped/meteochile/wrf-scel-330021.json` is a doc-shaped MeteoChile `getDatosModelo` body for station `330021` (Pudahuel / SCEL). It was built from MeteoChile's API document, not a live capture, so it is not a recorded fixture. It has no usuario, token, cookie, or auth header. The series use the shape `flattenHours` reads: `nombreElemento` plus a numeric `valorPronosticado` on each point. Coordinates and the 10.48 °C sample are the values published in MeteoChile document 24. `desk_parity::meteochile_wrf_matches_typescript_bytes` sets dummy `METEOCHILE_USER` / `METEOCHILE_TOKEN` values (`example-user`, `example-token`), replays this file, and compares `/api/forecast?icao=SCEL` to `forecast-wrf-scel.body`. That body is the Node envelope for this fixture at `2026-11-18T03:00:00.000Z`.
