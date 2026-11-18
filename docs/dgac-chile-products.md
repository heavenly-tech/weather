# DGAC Chile weather products — programmatic access (research)

Research for Step 1 of the Andes ceiling viewer. This is not legal advice; confirm terms with DGAC before operational use.

For the **official DGAC / IFIS** layer spike (METAR, TAF, SIGMET, NOTAM, AIP airspace) and PR 2–5 proposals, see [official-data/dgac-aip-chile.md](official-data/dgac-aip-chile.md).

| Product | Typical source | URL / endpoint | Access method | Notes |
| --- | --- | --- | --- | --- |
| METAR | NOAA AWC (Chile stations) | `https://aviationweather.gov/api/data/metar` | Open JSON API, no auth | Used in app today; not DGAC-hosted. |
| TAF | NOAA AWC | `https://aviationweather.gov/api/data/taf` | Open JSON API | Same as METAR. |
| SIGMET | NOAA AWC | `https://aviationweather.gov/api/data/isigmet` | Open JSON API | GAMET desk also ingests SIGMETs. |
| AIRMET | NOAA AWC | `https://aviationweather.gov/api/data/airep` / G-AIRMET feeds | Open API | Chile FIR coverage via AWC. |
| GAMET | DGAC OPMET | No stable public HTTP API found | **Blocked** — OPMET/AFTN distribution | Derived bulletin in-app from GFS + AWC SIGMETs. |
| SIGWX | WMO / WAFS | NOAA WAFS, OGIMET | Mixed; charts are HTTP | No single DGAC JSON API. |
| NOTAM | DGAC / USOF | `https://notaminfo.com` (aggregator), FAA SDK for US | Mixed; Chile often via paywalled AIP portals | **Blocked** without AIP credentials. |
| AIP Chile | DGAC | `https://ais.dgac.gob.cl/` | Web PDF/HTML | **No API**; scraping would violate terms. |

## MeteoChile (climatología / WRF-DMC)

| Product | URL | Access | Notes |
| --- | --- | --- | --- |
| WRF-DMC point | `https://climatologia.meteochile.gob.cl/application/datos/getDatosModelo` | `POST` with registered `usuario` + `token` | Documented in `METEOCHILE_*` env vars. |
| Public GFS columns | Open-Meteo | `GET` | Parent model for WRF; respect rate limits. |

## weather.heavenly.cl status (checked 2026-11-17 UTC)

| Check | Result |
| --- | --- |
| DNS A | `169.58.45.228` |
| HTTPS | `HTTP/1.1 503 Service Temporarily Unavailable` (nginx) |
| HTTP | Same 503 |

The hostname resolves but the origin currently returns **503** (service not available behind nginx). Do not assume production is up without hitting `/api/health` on the deployed stack.

## Open-Meteo models (Andes viewer)

| Model | `models=` id | Pressure-level cloud | Cloud base field |
| --- | --- | --- | --- |
| GFS | `gfs_seamless` | Yes | Not exposed (`undefined`) |
| ECMWF | `ecmwf_ifs025` | Yes | Not exposed |
| ICON | `icon_seamless` | Yes | `convective_cloud_base` (m), often null |
| GEM | `gem_seamless` | Yes | Not exposed |

Use `ecmwf_ifs025` — `ecmwf_ifs` returns null pressure levels on Open-Meteo.