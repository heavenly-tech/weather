import { interpolateGreatCircle, haversineKm } from "./geo";
import { fetchOpenMeteo, asList, extractLevels, openMeteoPressureUrlMulti, pickHourIndex, surfaceSnapshot } from "./open-meteo";
import { mockGramet } from "./mocks";
import { requireStation } from "./stations";
import type { GrametColumn, GrametProduct, ProductEnvelope } from "./types";
import { nowIso } from "./http";

export async function buildGramet(fromIcao: string, toIcao: string): Promise<ProductEnvelope<GrametProduct>> {
  const from = requireStation(fromIcao);
  const to = requireStation(toIcao);
  const points = interpolateGreatCircle({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }, 6);
  const result = await fetchOpenMeteo(openMeteoPressureUrlMulti(points));
  if (!result.ok) {
    return {
      data: mockGramet(from.icao, to.icao),
      source: "mock",
      sourceLabel: "Mock GRAMET (model circuit down)",
      fetchedAt: nowIso(),
      warning: `Open-Meteo did not return a route sounding: ${result.error}`,
    };
  }

  const list = asList(result.data);
  const columns: GrametColumn[] = list.map((response, i) => {
    const hourly = response.hourly ?? {};
    const times = (hourly.time ?? []) as string[];
    const index = pickHourIndex(times);
    const snap = surfaceSnapshot(hourly, index);
    const km = Math.round(haversineKm({ lat: from.lat, lon: from.lon }, points[i] ?? { lat: response.latitude, lon: response.longitude }));
    return {
      km,
      lat: response.latitude,
      lon: response.longitude,
      label: i === 0 ? from.icao : i === list.length - 1 ? to.icao : undefined,
      surfaceTempC: snap.surfaceTempC,
      cloudPct: snap.cloudPct,
      precipMm: snap.precipMm,
      weatherCode: snap.weatherCode,
      levels: extractLevels(hourly, index),
    };
  });

  return {
    data: {
      fromIcao: from.icao,
      toIcao: to.icao,
      fromName: from.city,
      toName: to.city,
      validTime: new Date().toISOString(),
      distanceKm: Math.round(haversineKm({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon })),
      columns,
    },
    source: "derived",
    sourceLabel: "Derived GRAMET from GFS pressure levels (Open-Meteo)",
    fetchedAt: nowIso(),
  };
}
