import {
  ANDES_MODELS,
  type AndesModelId,
  modelById,
  openMeteoForecastUrl,
} from "@/lib/andes/models";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import { refineCeilingGrid } from "@/lib/andes/ceiling-regrid";
import { defaultGridShape, domainGrid } from "@/lib/andes/domain";
import { fetchMultiBatched } from "@/lib/andes/batch-fetch";
import { cachedFetchUrl } from "@/lib/andes/open-meteo-cache";
import { parseUtcIso } from "@/lib/andes/parse-utc";
import { asSingle, fetchOpenMeteo, pickHourIndex } from "@/lib/open-meteo";
import type { FlightCategory } from "@/lib/types";

export type ModelAvailability = {
  id: AndesModelId;
  label: string;
  available: boolean;
  warning?: string;
};

export type CeilingCell = {
  lat: number;
  lon: number;
  elevM: number;
  ceilingFtAgl: number | null;
  category: FlightCategory;
  obscured: boolean;
  cloudBaseMslM?: number | null;
  lowCloudUnresolved?: boolean;
  /** Highest liquid precip rate (mm/h) in the coarse neighbourhood. */
  precipMmH?: number | null;
};

export type SliceField = {
  pressureHpa: number;
  values: { lat: number; lon: number; tempC: number | null; cloudPct: number | null }[];
};

function liquidPrecipMmH(hourly: Record<string, Array<number | null> | string[]>, index: number): number {
  const read = (key: string) => {
    const value = hourly[key]?.[index];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  return Math.max(read("precipitation"), read("rain"), read("showers"));
}

const probeCache = new Map<string, { at: number; data: ModelAvailability[] }>();
const PROBE_TTL_MS = 15 * 60 * 1000;

export async function probeModels(lat: number, lon: number): Promise<ModelAvailability[]> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = probeCache.get(key);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.data;

  const out: ModelAvailability[] = [];
  for (const meta of ANDES_MODELS) {
    const url = openMeteoForecastUrl(lat, lon, meta.id, { forecastHours: 1, pastHours: 0 });
    const res = await fetchOpenMeteo(url);
    if (!res.ok) {
      out.push({ id: meta.id, label: meta.label, available: false, warning: res.error });
      continue;
    }
    const hourly = asSingle(res.data).hourly ?? {};
    const hasLevel = Boolean(hourly.cloud_cover_850hPa);
    out.push({
      id: meta.id,
      label: meta.label,
      available: hasLevel,
      warning: hasLevel ? undefined : "Pressure-level cloud cover missing",
    });
  }
  probeCache.set(key, { at: Date.now(), data: out });
  return out;
}

export async function fetchCeilingGrid(
  model: AndesModelId,
  validTime?: string
): Promise<{
  cells: CeilingCell[];
  modelRun: string | null;
  gridShape: { rows: number; cols: number };
  coarseShape?: { rows: number; cols: number };
  timeLabels?: string[];
  unavailable?: string;
}> {
  const meta = modelById(model);
  if (!meta) return { cells: [], modelRun: null, gridShape: defaultGridShape(), unavailable: "Unknown model" };

  const coarseShape = defaultGridShape();
  const grid = domainGrid();
  const batched = await fetchMultiBatched(grid, model);
  if (!batched.ok) {
    return { cells: [], modelRun: null, gridShape: coarseShape, unavailable: batched.error };
  }

  const list = batched.list;
  const coarseSamples: {
    lat: number;
    lon: number;
    baseMslM: number | null;
    obscured: boolean;
    lowCloudUnresolved: boolean;
    precipMmH: number | null;
  }[] = [];

  const targetDate = validTime ? parseUtcIso(validTime) : new Date();

  list.forEach((point, idx) => {
    const hourly = point.hourly ?? {};
    const times = (hourly.time ?? []) as string[];
    const index = pickHourIndex(times, targetDate);
    const elevM = point.elevation ?? grid[idx]?.elevM ?? 0;
    const sample = ceilingFromHourly(hourly, index, elevM);
    coarseSamples.push({
      lat: point.latitude,
      lon: point.longitude,
      baseMslM: sample.cloudBaseMslM,
      obscured: sample.obscured,
      lowCloudUnresolved: sample.lowCloudUnresolved,
      precipMmH: liquidPrecipMmH(hourly, index),
    });
  });

  const refined = await refineCeilingGrid(coarseSamples, coarseShape.rows, coarseShape.cols);

  const first = list[0]?.hourly;
  const times = (first?.time ?? []) as string[];
  const index = pickHourIndex(times, targetDate);
  const modelRun = times[index] ?? null;

  return {
    cells: refined.cells,
    modelRun,
    gridShape: { rows: refined.rows, cols: refined.cols },
    coarseShape,
    timeLabels: times,
  };
}

export async function fetchPointHourly(
  model: AndesModelId,
  lat: number,
  lon: number,
  opts: { forecastHours?: number; pastHours?: number } = {}
) {
  const meta = modelById(model);
  const url = openMeteoForecastUrl(lat, lon, model, {
    forecastHours: opts.forecastHours ?? 48,
    pastHours: opts.pastHours ?? 24,
  });
  const cached = await cachedFetchUrl(url, model);
  if (!cached.ok) {
    return { ok: false as const, error: `HTTP ${cached.status}`, meta };
  }
  const body = asSingle((await cached.json()) as import("@/lib/open-meteo").OpenMeteoResponse);
  const hourly = body.hourly ?? {};
  return {
    ok: true as const,
    hourly,
    elevM: body.elevation ?? 0,
    meta,
    runTimes: (hourly.time ?? []) as string[],
  };
}

export function sliceAtPressure(
  hourly: Record<string, Array<number | null> | string[]>,
  index: number,
  pressureHpa: number
): { tempC: number | null; cloudPct: number | null } {
  const tempC = hourly[`temperature_${pressureHpa}hPa`]?.[index] as number | null | undefined;
  const cloudPct = hourly[`cloud_cover_${pressureHpa}hPa`]?.[index] as number | null | undefined;
  return {
    tempC: typeof tempC === "number" ? tempC : null,
    cloudPct: typeof cloudPct === "number" ? cloudPct : null,
  };
}