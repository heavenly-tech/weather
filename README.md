# Heavenly Weather

Chile-first aviation briefing desk for METAR, TAF, GRAMET, GAMET, MeteoChile WRF point forecasts, synoptic charts, and a Cesium 3D weather field. Public hostname: [weather.heavenly.cl](https://weather.heavenly.cl). There is **no user login**. Licensed under MIT (Heavenly Tech / Pablo Andalaft).

## Run locally

```bash
npm install
cp .env.example .env.local   # optional MeteoChile token
npm run dev
```

The dev server binds `0.0.0.0:43123`. Open http://127.0.0.1:43123.

## Docker (drop into a reverse-proxied stack)

Internal listen port is **4310**. Proxy `weather.heavenly.cl` to that port. The app does not assume Traefik, Caddy, or nginx labels.

```bash
docker compose up --build -d
```

Local check: http://127.0.0.1:4310  
Health: http://127.0.0.1:4310/api/health

Optional environment on the `weather` service:

| Variable | Purpose |
| --- | --- |
| `METEOCHILE_USER` | Email registered with MeteoChile Servicios Climáticos |
| `METEOCHILE_TOKEN` | Personal token for WRF-DMC `getDatosModelo` |

Without those, the WRF page uses live Open-Meteo GFS (the parent model WRF-DMC nests from) and labels the source as fallback.

## What is live vs mocked

| Product | Live source | Fallback |
| --- | --- | --- |
| METAR / TAF | NOAA Aviation Weather Center | Clearly marked mock observation/forecast |
| GRAMET | Derived from Open-Meteo GFS pressure levels along the route | Mock sounding |
| GAMET | Derived GAMET-style bulletin from GFS + AWC SIGMETs (official DGAC GAMET is OPMET-only) | Mock bulletin |
| Point forecast | MeteoChile WRF-DMC when a token is set | Open-Meteo GFS, then mock |
| Synoptic | NOAA WPC South America charts, proxied | Error state with a link to NOAA |
| 3D field | Live METARs + GFS column on a Cesium globe (OpenStreetMap tiles) | Mock stations |

## Notes

- Chile-first ICAO list (SCEL, SCFA, SCTE, SCCI, …) plus Lima and Ezeiza for international GRAMETs.
- Every product card shows **Live / Fallback / Derived / Mock**.
- 3D visualization is Cesium only (no Three.js).
- Not a certified flight-briefing source. Cross-check OPMET before you fly.
