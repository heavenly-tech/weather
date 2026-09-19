import { ceilingFtFromClouds } from "./visibility";
import type { MetarObservation } from "./types";

/** Chile CTR VFR takeoff/landing (DAN 91.201(b) / AIP ENR 1.2 §2). */
export const CHILE_CTR_VFR_VIS_M = 5000;
export const CHILE_CTR_VFR_CEIL_FT = 1500;
export const CHILE_CTR_VFR_CEIL_M = 450;

/** Chile Special VFR, airplanes (DAN 91.203 / AIP ENR 1.2 §9). */
export const CHILE_SVFR_AIRPLANE_VIS_M = 2000;
export const CHILE_SVFR_AIRPLANE_CEIL_FT = 1150;
export const CHILE_SVFR_AIRPLANE_CEIL_M = 350;

/** Chile Special VFR, helicopters — visibility only is published in ENR 1.2 §9.1. */
export const CHILE_SVFR_HELI_VIS_M = 500;

/** Class G takeoff/landing, airplanes (DAN 91.201(d)). */
export const CHILE_CLASS_G_AIRPLANE_VIS_M = 2000;
export const CHILE_CLASS_G_HELI_VIS_M = 500;

export type ChileMarginFit = "ctr-vfr" | "svfr-window" | "below-svfr" | "unknown";

export function chileCtrMarginFit(
  visM: number | null | undefined,
  ceilingFt: number | null | undefined
): ChileMarginFit {
  if (visM == null) return "unknown";
  const ceil = ceilingFt ?? Number.POSITIVE_INFINITY;
  if (visM >= CHILE_CTR_VFR_VIS_M && ceil >= CHILE_CTR_VFR_CEIL_FT) return "ctr-vfr";
  if (visM >= CHILE_SVFR_AIRPLANE_VIS_M && ceil >= CHILE_SVFR_AIRPLANE_CEIL_FT) return "svfr-window";
  return "below-svfr";
}

export function metarChileFit(metar: MetarObservation): ChileMarginFit {
  return chileCtrMarginFit(metar.visM, ceilingFtFromClouds(metar.clouds));
}
