import { fetchJson, nowIso } from "@/lib/http";
import { parseAwcMetar, parseAwcTaf } from "@/lib/awc";
import { mockForecast, mockMetar, mockTaf, mockVizStations } from "@/lib/mocks";
import { getStation, chileStations, requireStation } from "@/lib/stations";
import { fetchMeteoChileWrf } from "@/lib/meteochile";
import {
  asSingle,
  extractLevels,
  fetchOpenMeteo,
  openMeteoPressureUrl,
  openMeteoSurfaceUrl,
  pickHourIndex,
  surfaceSnapshot,
  toPointForecast,
} from "@/lib/open-meteo";
import { SYNOPTIC_PRODUCTS } from "@/lib/synoptic";
import type {
  MetarObservation,
  PointForecast,
  ProductEnvelope,
  SynopticProduct,
  TafForecast,
  VizStation,
} from "@/lib/types";

export function normalizeIcao(value: string | string[] | undefined, fallback = "SCEL"): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? fallback).split(",")[0].trim().toUpperCase() || fallback;
}

export async function loadMetar(icao: string): Promise<ProductEnvelope<MetarObservation>> {
  const result = await fetchJson<unknown[]>(
    `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`
  );

  if (!result.ok || !Array.isArray(result.data) || result.data.length === 0) {
    return {
      data: mockMetar(icao),
      source: "mock",
      sourceLabel: "Mock METAR (AWC did not return an observation)",
      fetchedAt: nowIso(),
      warning: result.ok ? `No METAR on file for ${icao}.` : result.error,
    };
  }

  const parsed = parseAwcMetar(result.data[0] as Parameters<typeof parseAwcMetar>[0]);
  const station = getStation(icao);
  return {
    data: {
      ...parsed,
      icao: parsed.icao || icao,
      name: parsed.name || (station ? `${station.city} / ${station.name}` : icao),
    },
    source: "live",
    sourceLabel: "Live METAR from NOAA Aviation Weather Center",
    fetchedAt: nowIso(),
  };
}

export async function loadTaf(icao: string): Promise<ProductEnvelope<TafForecast>> {
  const result = await fetchJson<unknown[]>(
    `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=json`
  );

  if (!result.ok || !Array.isArray(result.data) || result.data.length === 0) {
    return {
      data: mockTaf(icao),
      source: "mock",
      sourceLabel: "Mock TAF (AWC did not return a forecast)",
      fetchedAt: nowIso(),
      warning: result.ok ? `No TAF on file for ${icao}.` : result.error,
    };
  }

  const parsed = parseAwcTaf(result.data[0] as Parameters<typeof parseAwcTaf>[0]);
  const station = getStation(icao);
  return {
    data: {
      ...parsed,
      icao: parsed.icao || icao,
      name: parsed.name || (station ? `${station.city} / ${station.name}` : icao),
    },
    source: "live",
    sourceLabel: "Live TAF from NOAA Aviation Weather Center",
    fetchedAt: nowIso(),
  };
}

export async function loadForecast(icao: string): Promise<ProductEnvelope<PointForecast>> {
  const station = requireStation(icao);

  const wrf = await fetchMeteoChileWrf(icao);
  if (wrf && wrf.hours.length) {
    return {
      data: wrf,
      source: "live",
      sourceLabel: "Live WRF-DMC from MeteoChile",
      fetchedAt: nowIso(),
    };
  }

  const meteo = await fetchOpenMeteo(openMeteoSurfaceUrl(station.lat, station.lon, 5));
  if (meteo.ok) {
    const data = toPointForecast(
      station.icao,
      `${station.city} / ${station.name}`,
      "GFS via Open-Meteo (WRF-DMC parent model)",
      asSingle(meteo.data)
    );
    return {
      data,
      source: "fallback",
      sourceLabel: process.env.METEOCHILE_TOKEN
        ? "Open-Meteo GFS (MeteoChile WRF did not return a series)"
        : "Open-Meteo GFS fallback — set METEOCHILE_USER and METEOCHILE_TOKEN for WRF-DMC",
      fetchedAt: nowIso(),
      warning: station.meteochileId
        ? undefined
        : `No MeteoChile station id mapped for ${station.icao}; GFS is used at the aerodrome coordinates.`,
    };
  }

  return {
    data: mockForecast(icao),
    source: "mock",
    sourceLabel: "Mock point forecast (model circuit down)",
    fetchedAt: nowIso(),
    warning: meteo.error,
  };
}

export function loadSynoptic(): ProductEnvelope<SynopticProduct[]> {
  return {
    data: SYNOPTIC_PRODUCTS,
    source: "live",
    sourceLabel: "NOAA WPC International Desk charts (proxied)",
    fetchedAt: nowIso(),
  };
}

export async function loadViz(focusIcao: string): Promise<ProductEnvelope<VizStation[]>> {
  const focusStation = requireStation(focusIcao);
  const stations = chileStations().filter((s) => s.icao !== "SCIP");

  const ids = stations.map((s) => s.icao).join(",");
  const [metarResult, modelResult] = await Promise.all([
    fetchJson<unknown[]>(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json`),
    fetchOpenMeteo(openMeteoPressureUrl(focusStation.lat, focusStation.lon)),
  ]);

  const metars = new Map(
    (metarResult.ok && Array.isArray(metarResult.data) ? metarResult.data : [])
      .map((row) => parseAwcMetar(row as Parameters<typeof parseAwcMetar>[0]))
      .filter((m) => m.icao)
      .map((m) => [m.icao, m])
  );

  let focusLevels = mockVizStations()[0]?.levels ?? [];
  let focusCloud: number | null = null;
  let focusPrecip: number | null = null;
  if (modelResult.ok) {
    const hourly = asSingle(modelResult.data).hourly ?? {};
    const index = pickHourIndex((hourly.time ?? []) as string[]);
    focusLevels = extractLevels(hourly, index);
    const snap = surfaceSnapshot(hourly, index);
    focusCloud = snap.cloudPct;
    focusPrecip = snap.precipMm;
  }

  if (!metarResult.ok && !modelResult.ok) {
    return {
      data: mockVizStations(),
      source: "mock",
      sourceLabel: "Mock 3D field (weather circuit down)",
      fetchedAt: nowIso(),
      warning: metarResult.ok ? modelResult.error : metarResult.error,
    };
  }

  const data: VizStation[] = stations.map((s) => {
    const metar = metars.get(s.icao);
    const isFocus = s.icao === focusStation.icao;
    return {
      icao: s.icao,
      name: s.city,
      lat: s.lat,
      lon: s.lon,
      elevM: s.elevM,
      flightCategory: metar?.flightCategory ?? "UNK",
      tempC: metar?.tempC ?? null,
      windKt: metar?.windKt ?? null,
      windDirDeg: metar?.windDirDeg ?? null,
      cloudPct: isFocus ? focusCloud : null,
      precipMm: isFocus ? focusPrecip : null,
      levels: isFocus ? focusLevels : [],
    };
  });

  return {
    data,
    source: metarResult.ok ? "live" : "fallback",
    sourceLabel: metarResult.ok
      ? "Live METARs plus GFS column at the selected aerodrome"
      : "GFS column only (METAR circuit down)",
    fetchedAt: nowIso(),
    warning: metarResult.ok ? undefined : metarResult.error,
  };
}
