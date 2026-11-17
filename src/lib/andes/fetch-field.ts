import {
  ANDES_MODELS,
  type AndesModelId,
  modelById,
  openMeteoForecastUrl,
} from "@/lib/andes/models";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import { defaultGridShape, domainGrid } from "@/lib/andes/domain";
import { fetchMultiBatched } from "@/lib/andes/batch-fetch";
import { cachedFetchUrl } from "@/lib/andes/open-meteo-cache";
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
};

export type SliceField = {
  pressureHpa: number;
  values: { lat: number; lon: number; tempC: number | null; cloudPct: number | null }[];
};

export async function probeModels(lat: number, lon: number): Promise<ModelAvailability[]> {
  const out: ModelAvailability[] = [];
  for (const meta of ANDES_MODELS) {
    const url = openMeteoForecastUrl(lat, lon, meta.id, 1);
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
  return out;
}

export async function fetchCeilingGrid(
  model: AndesModelId,
  validTime?: string
): Promise<{
  cells: CeilingCell[];
  modelRun: string | null;
  gridShape: { rows: number; cols: number };
  timeLabels?: string[];
  unavailable?: string;
}> {
  const meta = modelById(model);
  if (!meta) return { cells: [], modelRun: null, gridShape: defaultGridShape(), unavailable: "Unknown model" };

  const gridShape = defaultGridShape();
  const grid = domainGrid();
  const batched = await fetchMultiBatched(grid, model, 1);
  if (!batched.ok) {
    return { cells: [], modelRun: null, gridShape, unavailable: batched.error };
  }

  const list = batched.list;
  const cells: CeilingCell[] = [];

  list.forEach((point, idx) => {
    const hourly = point.hourly ?? {};
    const times = (hourly.time ?? []) as string[];
    const index = validTime ? pickHourIndex(times, new Date(validTime)) : pickHourIndex(times);
    const elevM = point.elevation ?? grid[idx]?.elevM ?? 0;
    const sample = ceilingFromHourly(hourly, index, elevM);
    cells.push({
      lat: point.latitude,
      lon: point.longitude,
      elevM,
      ceilingFtAgl: sample.ceilingFtAgl,
      category: sample.ceilingCategory,
      obscured: sample.obscured,
    });
  });

  const first = list[0]?.hourly;
  const times = (first?.time ?? []) as string[];
  const index = validTime ? pickHourIndex(times, new Date(validTime)) : pickHourIndex(times);
  const modelRun = times[index] ?? null;

  return { cells, modelRun, gridShape, timeLabels: times };
}

export async function fetchPointHourly(model: AndesModelId, lat: number, lon: number, days = 2) {
  const meta = modelById(model);
  const url = openMeteoForecastUrl(lat, lon, model, days);
  const cached = await cachedFetchUrl(url, model);
  if (!cached.ok) {
    return { ok: false as const, error: `HTTP ${cached.status}`, meta };
  }
  const body = asSingle((await cached.json()) as import("@/lib/open-meteo").OpenMeteoResponse);
  return {
    ok: true as const,
    hourly: body.hourly ?? {},
    elevM: body.elevation ?? 0,
    meta,
    runTimes: (body.hourly?.time ?? []) as string[],
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
