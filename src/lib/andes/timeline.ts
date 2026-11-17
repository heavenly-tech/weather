import { andesAirfield, type AndesAirfield } from "@/lib/andes/airfields";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import type { AndesModelId } from "@/lib/andes/models";
import { fetchPointHourly } from "@/lib/andes/fetch-field";
import { parseAwcMetar } from "@/lib/awc";
import { fetchJson } from "@/lib/http";
import { haversineKm } from "@/lib/geo";
import { ceilingFtFromClouds } from "@/lib/visibility";

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return haversineKm(a, b);
}

export type TimelinePoint = {
  time: string;
  ceilingFtAgl: number | null;
  category: string;
};

export type ObservedCeilingSeries = {
  label: string;
  points: TimelinePoint[];
};

export type ModelCeilingSeries = {
  model: AndesModelId;
  label: string;
  points: TimelinePoint[];
  unavailable?: string;
};

export async function modelCeilingTimeline(
  field: AndesAirfield,
  model: AndesModelId,
  hours = 24
): Promise<ModelCeilingSeries> {
  const fetched = await fetchPointHourly(model, field.lat, field.lon, 2);
  if (!fetched.ok || !fetched.meta) {
    return {
      model,
      label: model,
      points: [],
      unavailable: fetched.error ?? "Unavailable",
    };
  }

  const hourly = fetched.hourly;
  const times = (hourly.time ?? []) as string[];
  const elevM = fetched.elevM || field.elevM;
  const cloudKey = fetched.meta.cloudBaseField;

  const points: TimelinePoint[] = times.slice(0, hours).map((time, index) => {
    const s = ceilingFromHourly(hourly, index, elevM, cloudKey);
    return {
      time,
      ceilingFtAgl: s.ceilingFtAgl,
      category: s.ceilingCategory,
    };
  });

  return { model, label: fetched.meta.label, points };
}

export async function observedMetarCeilings(icao: string, hours = 24): Promise<ObservedCeilingSeries | null> {
  const res = await fetchJson<unknown[]>(
    `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json&hours=${hours}`
  );
  if (!res.ok || !Array.isArray(res.data)) return null;

  const points: TimelinePoint[] = res.data
    .map((row) => parseAwcMetar(row as Parameters<typeof parseAwcMetar>[0]))
    .filter((m) => m.observedAt)
    .map((m) => ({
      time: m.observedAt!,
      ceilingFtAgl: ceilingFtFromClouds(m.clouds),
      category: m.flightCategory,
    }))
  .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  return { label: `obs: ${icao}`, points };
}

export async function buildAirfieldTimelines(icao: string): Promise<{
  field: AndesAirfield;
  observation: ObservedCeilingSeries | null;
  obsProxyLabel: string | null;
  models: ModelCeilingSeries[];
}> {
  const field = andesAirfield(icao);
  if (!field) throw new Error(`Unknown airfield ${icao}`);

  const metarIcao = field.hasMetar ? field.icao : field.nearestMetarIcao ?? "SCEL";
  const observation = await observedMetarCeilings(metarIcao, 36);

  let obsProxyLabel: string | null = null;
  if (!field.hasMetar) {
    const ref =
      andesAirfield(metarIcao) ??
      andesAirfield("SCEL") ?? { lat: -33.393, lon: -70.786, icao: metarIcao, name: "", elevM: 0, hasMetar: true };
    const km = haversine(field, ref);
    obsProxyLabel = `obs: ${metarIcao} (nearest METAR, ${km.toFixed(0)} km)`;
    if (observation) observation.label = obsProxyLabel;
  }

  const models: AndesModelId[] = ["gfs_seamless", "ecmwf_ifs025", "icon_seamless", "gem_seamless"];
  const series = await Promise.all(models.map((m) => modelCeilingTimeline(field, m)));

  return { field, observation, obsProxyLabel, models: series };
}