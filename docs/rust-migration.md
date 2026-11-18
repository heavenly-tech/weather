# Rust + scratch-image migration

Design note only. [PR #7](https://github.com/heavenly-tech/weather/pull/7) merged as `2bc9325` on `main`. The port starts from that commit. It is the encoder: ECMWF cloud base, HZ dropped when precipitation is present, `max(low, mid)`, trace rain, mid-deck `-RA`, and the TAF `DD24` clamp. Do not port the pre-#7 tree (`e59971b`): that tree still treats ECMWF rain as showers, can emit `FEW00x` from a low LCL, lets total cloud invent a `BKN`, and writes a midnight `BECMG` as `1823/1900` instead of `1823/1824`.

Replace `node:22-alpine` + Next standalone `server.js` ([Dockerfile](../Dockerfile)) with one static musl binary on `FROM scratch`, as in [heavenly-tech/flight_vis](https://github.com/heavenly-tech/flight_vis) (`Dockerfile`, `server-rs/`). Weather has no ffmpeg, so the image is the binary, `/app/dist`, CA certificates, and `/app/data`.

## 1. Target architecture

**axum.** flight_vis already uses axum 0.8 on tokio, and its `healthcheck` subcommand exists because scratch has no shell or curl (`server-rs/src/main.rs`). Every weather route is GET JSON or a static file. `reqwest` + `rustls`, with native roots and `SSL_CERT_FILE` on the copied bundle, does outbound HTTPS.

The binary owns all server logic now in TS. Routes:

| Route | File | Query | Notes |
| --- | --- | --- | --- |
| `GET /api/health` | `src/app/api/health/route.ts` | — | `{ ok: true, service: "heavenly-weather" }` |
| `GET /api/config` | `src/app/api/config/route.ts` | — | `CESIUM_ION_TOKEN` or `NEXT_PUBLIC_CESIUM_ION_TOKEN` |
| `GET /api/metar` | `src/app/api/metar/route.ts` | `icao` (default `SCEL`) | AWC, `src/lib/products.ts`, `src/lib/awc.ts` |
| `GET /api/taf` | `src/app/api/taf/route.ts` | `icao` | AWC |
| `GET /api/forecast` | `src/app/api/forecast/route.ts` | `icao` | MeteoChile WRF (`src/lib/meteochile.ts`), else GFS, else mock |
| `GET /api/gramet` | `src/app/api/gramet/route.ts` | `from` (`SCEL`), `to` (`SCTE`) | `src/lib/gramet.ts` |
| `GET /api/gamet` | `src/app/api/gamet/route.ts` | `fir` | `src/lib/gamet.ts`, GFS + AWC SIGMET |
| `GET /api/synoptic` | `src/app/api/synoptic/route.ts` | — | `src/lib/synoptic.ts` |
| `GET /api/synoptic/image` | `src/app/api/synoptic/image/route.ts` | `id` (`sam-12`) | NOAA bytes; `cache-control: public, max-age=300` |
| `GET /api/viz` | `src/app/api/viz/route.ts` | `icao` | AWC + GFS column |
| `GET /api/andes/models` | `src/app/api/andes/models/route.ts` | — | `probeModels` (`src/lib/andes/fetch-field.ts`) |
| `GET /api/andes/times` | `src/app/api/andes/times/route.ts` | `model` (`gfs_seamless`) | SCTB point hourly (`src/lib/andes/domain.ts`) |
| `GET /api/andes/ceiling` | `src/app/api/andes/ceiling/route.ts` | `model`, `validTime` | `fetchCeilingGrid` |
| `GET /api/andes/slice` | `src/app/api/andes/slice/route.ts` | `model`, `hpa` (`850`), `validTime` | `fetchMultiBatched`, `sliceAtPressure` |
| `GET /api/andes/timeline` | `src/app/api/andes/timeline/route.ts` | `icao` (`SCEL`) | `src/lib/andes/timeline.ts` |
| `GET /api/andes/coherence` | `src/app/api/andes/coherence/route.ts` | `icao` (`SCEL`), `model` | METAR + TAF + hourly + `coherence.ts` |
| `GET /api/generated/metar` | `src/app/api/generated/metar/route.ts` | `icao` (`SCTB`), `model` | 400 bad model, 502 model down |
| `GET /api/generated/taf` | `src/app/api/generated/taf/route.ts` | `icao` (`SCTB`), `model` | same |

Status codes are the contract. `/api/andes/slice` and `/api/andes/times` return **200** with an empty payload and `unavailable` / `error`. Generated products return **502** / **400**.

Libraries that move with the routes: `open-meteo-cache.ts`, `batch-fetch.ts`, `fetch-field.ts`, `models.ts`, `elevation-cache.ts`, `elevation-static.ts` (reads `data/andes-fine-elevation.json`), `src/lib/open-meteo.ts`, `src/lib/http.ts`; `ceiling.ts`, `ceiling-regrid.ts`, `domain.ts`, `altitude.ts`; `wmo-metar.ts`, `wmo-metar-wx.ts`, `wmo-taf.ts`, `taf-format.ts`, `wmo-annex3.ts`, `wmo-vis-wx.ts`, `visibility-estimate.ts`, `product-rmk.ts`, `product-log.ts` (JSONL at `/app/data`, off unless `PRODUCT_LOG_ENABLED=1`); `awc.ts`, `meteochile.ts`, `gamet.ts`, `gramet.ts`, `synoptic.ts`, `products.ts`, `chile-vfr.ts`, `visibility.ts`, `geo.ts`, `format.ts`, `stations.ts`, `mocks.ts`, `airfields.ts`, `airfield-msa.ts`, `parse-utc.ts`.

Cache (`open-meteo-cache.ts`): key is the exact URL. TTLs are GFS and ICON 3 h, ECMWF and GEM 6 h, elevation 30 d, else 15 min. Identical in-flight URLs share one fetch; each waiter gets its own body. Only HTTP 200 is stored. A 429 is not stored, so `batch-fetch.ts` can sleep `4 × OPEN_METEO_BATCH_DELAY_MS` (default 1 s) and retry once. Batch size default 60. User-Agent stays `heavenly-weather/0.1 (andes-viewer; non-commercial; respect-rate-limits)`. Host stays `https://api.open-meteo.com`, no API key.

| Script | Becomes |
| --- | --- |
| `scripts/validate-ceilings.ts` | `weather validate-ceilings` (network bin) |
| `scripts/smoke-open-meteo-schema.ts` | `weather smoke-schema` (still opt-in) |
| `scripts/print-sctb-products.ts` | `weather print-sctb`, also the fixture recorder |
| `scripts/generate-andes-elevation.ts` | `weather generate-elevation`, on a build machine when the grid changes |
| `scripts/copy-cesium.mjs` | Vite static copy |
| `scripts/capture-andes-screenshots.mjs` | stays Playwright against port 4310 |

## 2. Frontend

**Vite, not Next `output: 'export'`.** flight_vis already ships a Vite bundle at `/app/dist` (`FLIGHT_VIS_DIST`, `server-rs/src/static_files.rs`, Cesium via `vite-plugin-static-copy`). Static export does not fit:

- Eight pages are `dynamic = "force-dynamic"` and fetch during render: `src/app/page.tsx`, `forecast/page.tsx`, `gamet/page.tsx`, `gramet/page.tsx`, `metar-taf/page.tsx`, `vfr-svfr/page.tsx`, `viz/page.tsx`, `synoptic/page.tsx`. Export refuses that.
- All 18 route handlers are `force-dynamic` and call AWC, Open-Meteo, MeteoChile, or NOAA. Export drops them.
- `src/app/layout.tsx` loads Geist with `next/font/google` (build-time Google fetch). Self-host the files.
- No `generateStaticParams`. `?icao=`, `?from=&to=`, `?fir=` are request data.
- `cesium` is `serverExternalPackages`. `scripts/copy-cesium.mjs` copies `Workers`, `ThirdParty`, `Assets`, `Widgets` to `public/cesium`. The Vite plugin does the same and sets `CESIUM_BASE_URL`. Bundling the workers makes the globe 404.

`/andes` is already a client desk (`src/app/andes/page.tsx`). The other pages become client routes that call the same `/api/*` URLs, so their first paint is client-rendered. Paths stay `/`, `/andes`, `/forecast`, `/gamet`, `/gramet`, `/metar-taf`, `/synoptic`, `/vfr-svfr`, `/viz`. Axum falls unknown paths back to `index.html`. Tailwind v4 moves to `@tailwindcss/vite`. There is no `next/image`, middleware, or cookies.

**On disk, not embedded.** Cesium's Workers and Assets dominate the image. `rust-embed` would rebuild the binary to change a worker. Copy `./dist` to `/app/dist` (`WEATHER_DIST`), as flight_vis does. Copy `data/andes-fine-elevation.json` to `/app/data` and read it at startup. The product log is the only write.

## 3. Build

1. `node:22-alpine`: `npm ci`, `vite build`.
2. `rust:1.98.0-alpine` (musl) with `cargo-chef`, then `cargo build --release`. flight_vis pins this image.
3. `alpine:3`: copy `/etc/ssl/certs` and `/etc/ssl/cert.pem` from `ca-certificates`, and an empty `/app/data` owned `65534:65534`. No shell and no wget.
4. `FROM scratch`. Binary at `/app/weather`, dist, certs, data. `USER 65534` (this image's uid today; flight_vis uses `10001` only because it has ffmpeg and a passwd entry). `EXPOSE 4310`. `ENV PORT=4310 SSL_CERT_FILE=/etc/ssl/cert.pem WEATHER_DIST=/app/dist`.

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/app/weather", "healthcheck"]
CMD ["/app/weather"]
```

`weather healthcheck` dials `127.0.0.1:$PORT`, sends `GET /api/health`, and exits 0 only for HTTP 200 with `"ok": true`. Compose today runs `node -e fetch(...)`, which cannot exist on scratch. Keep `VIRTUAL_HOST`, `LETSENCRYPT_HOST`, `VIRTUAL_PORT=4310`, and `proxy_network`.

```toml
[profile.release]
panic = "abort"
lto = "thin"
codegen-units = 1
strip = true
```

flight_vis does not set `panic = "abort"`. Weather should: it drops the unwinder from the musl binary. Do not unwrap on client input.

`deploy.sh` SSHes to heavenly and runs `docker compose up -d --build`. That stops. Image builds run on **omarchibald** or the **Mac mini** (Mac mini cross-builds `linux/amd64`). The VPS only runs a prebuilt image. GitHub Actions may `cargo test` and `npm test`; that is not a VPS build, and the deployed image is not the Actions artifact.

## 4. Test parity

Keep vitest until cutover. Map each file onto the Rust module:

| Vitest | Rust |
| --- | --- |
| `src/lib/andes/airfield-msa.test.ts` | `msa.rs` |
| `src/lib/andes/airfields.test.ts` | `airfields.rs` |
| `src/lib/andes/altitude.test.ts` | `altitude.rs` |
| `src/lib/andes/ceiling-regrid.test.ts` | `regrid.rs` |
| `src/lib/andes/ceiling.test.ts` | `ceiling.rs` |
| `src/lib/andes/wmo-metar-wx.test.ts` | `metar_wx.rs` (#7 ECMWF cases, on main as of `2bc9325`) |
| `src/lib/andes/wmo-metar.test.ts` | `metar.rs` |
| `src/lib/andes/wmo-taf.test.ts` | `taf.rs` + `taf_format.rs` |
| `src/lib/andes/generated-taf.test.ts` | `taf.rs` |
| `src/lib/andes/visibility-wind-taf.test.ts` | `visibility.rs`, gust in `metar.rs`, NSW in `taf.rs` |
| `src/lib/andes/wmo-vis-wx.test.ts` | `vis_wx.rs` |
| `src/lib/andes/product-rmk.test.ts` | `rmk.rs` |
| `src/lib/andes/open-meteo-cache.test.ts` | `cache.rs` (one shared flight, then `x-open-meteo-cache: hit`) |

Existing inputs (`tests/fixtures/*.json`, `docs/validation/scel-2026-11-17/`) are SCEL. Before any route switches, record **SCTB** (lat −33.456, lon −70.546, elev 649 m) for all four models with a frozen clock, and check them in at `tests/fixtures/recorded/` labeled `EXAMPLE` / `recorded` (UTC, model, URL, no key). Include the #7 hours: 2% low cloud with a low LCL, mid ≥ 50%, total cloud 90% with low/mid under 10%, trace rain 0.15 mm/h with total cloud under 25%, and a validity end at midnight. Also keep the review edge cases as goldens: validity `1812/1912` with `BECMG 1823/1901` (crosses midnight, not clamped to `1824`), the 600 hPa base when 700 hPa is missing, and an absent or null `cloud_cover_mid` falling back to the low-cloud decision.

Both languages read the same body. METAR and TAF strings are **byte-identical**, including the stamp, group order, and `RMK`. Regrid JSON is **byte-identical** (row-major order, `null` vs number, category token). No epsilon. `assertModelTafFormat` (`taf-format.ts`) runs on every golden TAF in both languages: reject `…/1900` and a group past `1800/1824`, accept `BECMG 1823/1824`.

**Dual-run.** Staging compose runs Node and Rust on two ports. A compare step feeds both the recorded bodies (not two live fetches) and diffs `/api/generated/metar`, `/api/generated/taf`, `/api/andes/ceiling`, and `/api/andes/slice`. A second pass diffs live `/api/metar`, `/api/taf`, `/api/gramet`, `/api/gamet`, and `/api/forecast` (status and body). The proxy stays on Node until the recorded set and one live hour match.

## 5. Parity risks

Port the functions on `main` at `2bc9325` (#7 merged), not `e59971b`.

**TAF merging and the DD24 clamp.** In `generateModelTaf` (`wmo-taf.ts`), a flip that is only `BR` / `HZ` / `-RA` / `-DZ`, with wind, vis, and ceiling in the same Annex 3 bin, is dropped when the run is under 2 h. At 2 h or more it is a `BECMG` ending at `min(i + 2, runEnd)`, using the weather at that end. A new shower shorter than 3 h and not reaching the validity end is `TEMPO`; otherwise a persistent change is a 2 h `BECMG` and a blip is `TEMPO`. Groups are stable-sorted by start epoch. Clearing weather emits `NSW`. #7's `changeWindow` clamps every `BECMG` / `TEMPO` / `PROB` end to the validity end. Midnight (`h = m = s = 0`) is hour 24 of the previous day (`tafEndToken`): `1800/1824` and `BECMG 1823/1824`, never `1900`. A window shortened below an hour is kept. The group is dropped only when the start is at or after the validity end, or the clamped tokens match. `assertModelTafFormat` rejects end-hour `00` on the header and on every group, and rejects a group outside validity. On `2bc9325`, `changeWindow` clamps every end and `tafEndToken` writes midnight as `DD24`. A validity that runs through the next noon (`1812/1912`) keeps a cross-midnight `BECMG 1823/1901`; it is not rewritten to `1824`. Mitigation: one end-token function, and the #7 validator cases as Rust tests that fail the build. `chrono` stays in UTC. `DD24` on the 1st is the previous month's last day. A local `NaiveDateTime` shifts every group.

**Rounding.** Cloud height is `floor(ft / 100)`, minimum 1 (`cloudHeightHundredsFt`). TAF vis floors in 50 / 100 / 1000 m steps (`roundVisTafMeters`); METAR vis uses `Math.round` (`roundVisM`). Direction is `round(dir / 10) * 10`, with 0 → 360. Knots are `round(kmh / 1.852)`. A gust requires `gustKt >= kt + 10`. QNH floors. Temp rounds, and `(−0.5, 0)` is forced to `M00`. JS `Math.round` is half toward +∞ (`-1.5` → `-1`); Rust `f64::round` is half away from 0 (`-1.5` → `-2`). SCTB temperatures are negative. Mitigation: a `js_round` helper at every `Math.round` site, and floor-toward-−∞ at every `Math.floor`. No `round_ties_even`.

**Order and weather rules.** METAR body is ICAO, `DDHHMMZ`, wind, vis, weather, clouds, temp/dew, QNH, then `RMK`. `CLD EST` / `VIS EST` only in that `RMK` (`product-rmk.ts`). NSC when nothing significant is below `max(5000 ft, the 25 NM AIP MSA)` (`airfield-msa.ts`). VV when the base is within 5 m of terrain (`OBSC_EPS_M`). After #7, for `ecmwf_ifs025`:

- LCL is the base only if low cloud ≥ 10% and the LCL ≥ 1500 ft AGL. Otherwise 700 hPa AGL, or 600 hPa if 700 is missing. Cover is `BKN` / `SCT` / `FEW` at 2.5 / 0.5 mm/h.
- Broken is 62.5% of `max(low, mid)`, not total cloud. Cirrus must not write or block a layer.
- Liquid `< 0.2` mm/h and total cloud `< 25%`: no `-SHRA`, no `-RA`, no estimated layer.
- Mid ≥ 50%, no convective signal (`CAPE ≥ 100`, showers ≥ 0.1, or a convective base > 30 m above the field), and low cloud not dominant (low ≥ 50% or low ≥ mid): `-RA`, `BKN` at 700/600, `RMK CLD EST`. Convective or low cloud stays `-SHRA`.
- Drop `HZ` when a precip group is present. Keep `BR` at RH ≥ 80% (`visObscurationWx`: FG under 1000 m; BR/HZ from 1000 through 5000 inclusive).
- `FEW` / `SCT` do not set the flight category. `RA` stays in dry air if a layer exists, and is omitted with no layer, so it never sits on `NSC` or `NCD`.

`estimateVisibilityMeters` uses `exp` and `pow` (`60 * exp((-2.5 * (rh - 15)) / 80)`, `11.6 * r^-0.68`). V8 and musl libm can differ by an ulp, which `Math.round` then keeps. Match that operation order. The golden bar is the rounded token, not a relaxed string compare.

**Regrid.** `refineCeilingGrid` is not a weighted blend. Fine lat/lon are the linear position in the domain (lat −32.1 down to −34.8, lon −71.8 to −70.0). The four corners come from `floor`. The fractional weights are unused. `neighbourhoodBaseAndPrecip` keeps the **minimum** base and the **maximum** precip, so one coarse cell survives (`ceiling-regrid.test.ts`). A real bilinear blend fails that test.

Feet are `(baseMslM - elevM) * 3.280839895` with that literal, not `1/0.3048`, in that order, in f64. `interpolateCloudBaseMsl` uses `frac = (62.5 - c0) / (c1 - c0)`, then `h = below + frac * (above - below)`, then `max(terrain, h)`. Equal covers return `above.heightM` before the division. RH ≥ 87 fills a missing cover. Regrid does not round; the cloud group floors afterward. `numAt` is null for a missing key, JSON `null`, `NaN`, and infinities. Use `Option<f64>` and do not turn null into `0.0` (that invents sea level and a false obscuration). A bad elevation cell is `elevM: 0`, `category: "UNK"`, `ceilingFtAgl: null`, `lowCloudUnresolved: true`. The last fine row is exactly `fr / (fineRows - 1) == 1`, so the south and east corners collapse onto the edge. Layout is row-major (`floor(i / cols)`, `fr * fineCols + fc`), latitude decreasing with row. Default 11×8, `ANDES_RENDER_SUBDIV` 4. A length mismatch with the elevation file is a hard error.

**Cache and errors.** Query-parameter order is part of the key; build URLs the way `openMeteoForecastUrl` / `openMeteoMultiUrl` do. The first caller sets the TTL. Waiters share a 429, then the entry is dropped, so the retry is a new fetch. Caching the 429 would pin it for 3–6 h. Client-facing error text is sliced to 200 characters. Slice and times stay empty 200s; generated products stay 502. Elevation generation retries 429 four times at 4 s; the request path does not.

## 6. Phased plan

Each implementation PR targets `main`, which already contains #7 as `2bc9325`. None touch `cursor/andes-ecmwf-hz-7c33`.

1. **Skeleton.** `server-rs`, axum, `/api/health`, `weather healthcheck`, scratch Dockerfile, `panic = "abort"`. CI `cargo test`. Not deployed.
2. **Ceiling and regrid**, with the vitest cases and a recorded coarse-grid golden. No route changes.
3. **Encoder**, including every #7 rule, byte-identical to the SCTB fixtures. Node still serves traffic.
4. **Open-Meteo client**, cache, and the `/api/andes/*` and `/api/generated/*` routes. Dual-run starts here.
5. **Desk routes**: AWC, MeteoChile, GRAMET, GAMET, synoptic, viz, config.
6. **Vite client.** Move desks off server components.
7. **Cutover**, once the recorded set and one live hour match. `deploy.sh` ships an image built on omarchibald or the Mac mini. Heavenly runs that image and does not build. Node leaves the runtime image in this PR.

Until step 7 the site is unchanged for users: `https://weather.heavenly.cl`, no login, the same paths, query strings, and JSON, the `MODEL OUTPUT — NOT OFFICIAL` stamp, Cesium on OSM without a required Ion token, nginx-proxy on port 4310. The home desk's HTML is filled by a client fetch instead of a server component. The URL and the data stay the same.
