# Desk route parity fixtures

These bodies are the TypeScript desk-route output. `desk_parity::desk_routes_match_typescript_bytes` replays the recorded AWC and Open-Meteo files through the Rust routes and compares status, content type, cache-control, and body bytes. Tests do not open a live weather connection.

Recorded upstream files live in `tests/fixtures/recorded/awc/` and `tests/fixtures/recorded/sctb-gfs-seamless-2026-11-18.json`. They were captured on 2026-11-18. The SIGMET file is a subset of that day's feed (two Chile items plus one non-match), not a synthetic bulletin. EXAMPLE rows are the TypeScript mock envelopes used when the scripted upstream fails.

Night rows: live SCEL `180300Z` (00:00 CLST), the archived SCEL `170500Z` timeline, and the viz field built from those live METARs. Missing-field rows: SCEL CAVOK with an empty cloud list, the live SCTB TAF query that returned `[]`, and the recorded GFS body, which has no desk pressure-level series.

## Known deviations from TS

1. **Open-Meteo 200 that is not JSON.** `res.json()` throws in `fetchOpenMeteo`, and Next serves an HTML 500. Rust returns `502` `{"error":"<serde message>"}` with `content-type: application/json` and no `cache-control`. Pinned by `desk_parity::invalid_open_meteo_json_is_502_json`.
2. **AWC 200 that is not JSON.** `fetchJson` catches the parse error and the METAR/TAF/viz routes return the mock envelope. Rust takes that same mock branch. The warning text is serde's message (`expected ident at line 1 column 2` for `not-json`) rather than Node's `Unexpected token 'o', "not-json" is not valid JSON`. Pinned by `desk_parity::invalid_awc_json_stays_on_the_mock_envelope`.
