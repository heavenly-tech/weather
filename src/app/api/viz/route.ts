import { icaoParam, productResponse } from "@/lib/api";
import { fetchJson, nowIso } from "@/lib/http";
import { parseAwcMetar } from "@/lib/awc";
import { chileStations, requireStation } from "@/lib/stations";
import { mockVizStations } from "@/lib/mocks";
import {
  asSingle,
  extractLevels,
  fetchOpenMeteo,
  openMeteoPressureUrl,
  pickHourIndex,
  surfaceSnapshot,
} from "@/lib/open-meteo";
import type { ProductEnvelope, VizStation } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const focus = icaoParam(request);
  const focusStation = requireStation(focus);
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
    const envelope: ProductEnvelope<VizStation[]> = {
      data: mockVizStations(),
      source: "mock",
      sourceLabel: "Mock 3D field (weather circuit down)",
      fetchedAt: nowIso(),
      warning: metarResult.ok ? modelResult.error : metarResult.error,
    };
    return productResponse(envelope);
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

  const envelope: ProductEnvelope<VizStation[]> = {
    data,
    source: metarResult.ok ? "live" : "fallback",
    sourceLabel: metarResult.ok
      ? "Live METARs plus GFS column at the selected aerodrome"
      : "GFS column only (METAR circuit down)",
    fetchedAt: nowIso(),
    warning: metarResult.ok ? undefined : metarResult.error,
  };
  return productResponse(envelope);
}
