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

/**
 * The RH-only RUC branch never falls below about 4.2 km, even at saturation.
 * When the cloud base is at or below 100 ft AGL, the sky is obscured, or the
 * surface is very moist with a low base, estimated visibility is capped below
 * 1000 m so FG / VV rules can apply. Observed model visibility is left alone.
 */
export function capEstimatedVisForLowCloud(opts: {
  visM: number | null;
  estimated: boolean;
  ceilingFtAgl: number | null;
  obscured: boolean;
  spreadC: number | null;
  rhPct: number | null;
  lowCoverPct: number | null;
}): number | null {
  if (!opts.estimated) return opts.visM;
  const veryLowBase = opts.obscured || (opts.ceilingFtAgl != null && opts.ceilingFtAgl <= 100);
  const saturated = opts.rhPct != null && opts.rhPct >= 95 && opts.spreadC != null && opts.spreadC <= 2;
  const saturatedLow =
    saturated &&
    (veryLowBase ||
      (opts.ceilingFtAgl != null && opts.ceilingFtAgl <= 500) ||
      (opts.lowCoverPct != null && opts.lowCoverPct >= 62.5));
  if (!veryLowBase && !saturatedLow) return opts.visM;
  const fogVis = opts.obscured || (opts.spreadC != null && opts.spreadC <= 0.5) ? 400 : 800;
  if (opts.visM == null) return fogVis;
  return Math.min(opts.visM, fogVis);
}

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