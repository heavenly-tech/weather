import type { AndesModelId } from "@/lib/andes/models";

type Hourly = Record<string, Array<number | null> | string[]>;

function numAt(hourly: Hourly, key: string, index: number): number | null {
  const series = hourly[key];
  if (!series) return null;
  const value = series[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** GFS is the only Andes model that publishes Open-Meteo `visibility` on point fetches. */
export function usesObservedVisibility(model: AndesModelId | undefined): boolean {
  return model === "gfs_seamless";
}

/**
 * RUC/RAP-style surface visibility (Smirnova et al., RUC; NOAA UPP CALVIS_GSD):
 *
 * Moisture/haze (30% < RH ≤ 100%):
 *   Vis_km = 60 · exp(−2.5 · (RH − 15) / 80)   [Smirnova RUC parameterization]
 *
 * Precipitation (Marshall–Palmer / RUC precip branch, liquid mm/h):
 *   Vis_km = min(10, 11.6 · R_mm_h^(−0.68))
 *
 * Combined: Vis_m = 1000 · min(Vis_km_rh, Vis_km_precip, 10).
 */
export function estimateVisibilityMeters(rhPct: number, precipMmH: number): number {
  const rh = Math.min(100, Math.max(30, rhPct));
  const visRhKm = 60 * Math.exp((-2.5 * (rh - 15)) / 80);
  let visKm = visRhKm;
  if (precipMmH > 0.01) {
    const visPrecipKm = Math.min(10, 11.6 * precipMmH ** -0.68);
    visKm = Math.min(visKm, visPrecipKm);
  }
  return Math.min(10_000, Math.max(50, visKm * 1000));
}

function liquidPrecipMmH(hourly: Hourly, index: number): number {
  const total = numAt(hourly, "precipitation", index);
  if (total != null && total > 0) return total;
  const rain = numAt(hourly, "rain", index) ?? 0;
  const showers = numAt(hourly, "showers", index) ?? 0;
  const snow = numAt(hourly, "snowfall", index) ?? 0;
  return rain + showers + snow * 0.1;
}

export type ResolvedVisibility = {
  visM: number | null;
  /** True when visM comes from RH/precip estimate, not model visibility. */
  estimated: boolean;
};

export function resolveVisibilityMeters(
  hourly: Hourly,
  index: number,
  model?: AndesModelId
): ResolvedVisibility {
  const observed = usesObservedVisibility(model) ? numAt(hourly, "visibility", index) : null;
  if (observed != null) {
    return { visM: observed, estimated: false };
  }
  const rh = numAt(hourly, "relative_humidity_2m", index);
  if (rh == null) return { visM: null, estimated: false };
  const precip = liquidPrecipMmH(hourly, index);
  return { visM: estimateVisibilityMeters(rh, precip), estimated: true };
}