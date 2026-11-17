/**
 * Ceiling derivation for the Andes ceiling map (ft AGL above local terrain).
 *
 * ## Algorithm (documented for scoring / briefing review)
 *
 * 1. **Direct cloud-base fields** — When Open-Meteo returns `convective_cloud_base` or
 *    `cloud_base` (metres above ground / model surface), take the lowest non-null value
 *    as a candidate ceiling.
 *
 * 2. **Surface / underground levels** — At SCEL (~474 m) the surface is ~950–960 hPa;
 *    Andes gridpoints are higher still. Any pressure level **above** the local surface
 *    pressure (1000, 975 hPa, …) is underground; levels whose **geopotential height** is
 *    **≤ terrain elevation** are also skipped (extrapolated artefacts).
 *
 * 3. **Pressure-level cloud cover (BKN/OVC proxy)** — Scan from the surface upward. The
 *    lowest moist level **above ground** with **≥ 62.5 %** cover or RH ≥ 87 % sets the
 *    base MSL via `geopotential_height_*hPa`.
 *
 * 4. **AGL** — `(baseMslM - terrainElevM) * 3.28084`, floored at 0 ft (never negative).
 *
 * 5. **Mountain obscuration** — True when a qualifying cloud base exists above the
 *    surface-pressure stack but **MSL base ≤ terrain elevation** (terrain inside the layer),
 *    or when a direct cloud-base field reports 0 m AGL.
 */

import type { FlightCategory } from "@/lib/types";
import { flightCategoryFromWx } from "@/lib/visibility";

/** Five-eighths cloud cover — BKN threshold on a 0–100 % model field. */
export const BKN_CLOUD_COVER_PCT = 62.5;

export const CEILING_LEGEND = {
  VFR: { minFtAgl: 3001, label: "VFR", color: "#22c55e" },
  MVFR: { minFtAgl: 1000, maxFtAgl: 3000, label: "MVFR", color: "#38bdf8" },
  IFR: { minFtAgl: 500, maxFtAgl: 999, label: "IFR", color: "#fbbf24" },
  LIFR: { maxFtAgl: 499, label: "LIFR", color: "#f87171" },
} as const;

const M_TO_FT = 3.280839895;
const P0 = 1013.25;

export type CeilingSample = {
  ceilingFtAgl: number | null;
  ceilingCategory: FlightCategory;
  cloudBaseMslM: number | null;
  obscured: boolean;
  method: "cloud_base_field" | "pressure_level" | "unlimited";
};

type Hourly = Record<string, Array<number | null> | string[]>;

function numAt(hourly: Hourly | undefined, key: string, index: number): number | null {
  const series = hourly?.[key];
  if (!series) return null;
  const value = series[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const LEVELS_DESC = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300];

/** Local surface pressure (hPa): model `surface_pressure` or ISA from terrain elevation. */
export function surfacePressureHpa(hourly: Hourly, index: number, terrainElevM: number): number {
  const sp = numAt(hourly, "surface_pressure", index);
  if (sp != null && sp > 400 && sp < 1100) return sp;
  return P0 * Math.pow(1 - terrainElevM / 44330, 5.255);
}

/** Level is above ground at this point (not underground in pressure or height). */
export function pressureLevelAboveTerrain(
  levelHpa: number,
  geopotentialHeightM: number | null,
  terrainElevM: number,
  surfaceHpa: number
): boolean {
  if (levelHpa > surfaceHpa) return false;
  if (geopotentialHeightM == null) return false;
  return geopotentialHeightM > terrainElevM;
}

function isMoist(hourly: Hourly, index: number, hpa: number): boolean {
  const cover = numAt(hourly, `cloud_cover_${hpa}hPa`, index);
  const rh = numAt(hourly, `relative_humidity_${hpa}hPa`, index);
  return (cover != null && cover >= BKN_CLOUD_COVER_PCT) || (rh != null && rh >= 87);
}

export function ceilingFromHourly(
  hourly: Hourly,
  index: number,
  terrainElevM: number,
  cloudBaseKey: string | null
): CeilingSample {
  const surfaceHpa = surfacePressureHpa(hourly, index, terrainElevM);
  let cloudBaseMslM: number | null = null;
  let method: CeilingSample["method"] = "unlimited";

  if (cloudBaseKey) {
    const aglM = numAt(hourly, cloudBaseKey, index);
    if (aglM != null && aglM >= 0) {
      cloudBaseMslM = terrainElevM + aglM;
      method = "cloud_base_field";
    }
  }

  if (cloudBaseMslM == null) {
    for (const hpa of LEVELS_DESC) {
      if (hpa > surfaceHpa) continue;
      const hM = numAt(hourly, `geopotential_height_${hpa}hPa`, index);
      if (!pressureLevelAboveTerrain(hpa, hM, terrainElevM, surfaceHpa)) continue;
      if (!isMoist(hourly, index, hpa)) continue;
      cloudBaseMslM = hM;
      method = "pressure_level";
      break;
    }
  }

  if (cloudBaseMslM == null) {
    return {
      ceilingFtAgl: null,
      ceilingCategory: "VFR",
      cloudBaseMslM: null,
      obscured: false,
      method: "unlimited",
    };
  }

  const aglM = cloudBaseMslM - terrainElevM;
  const obscured =
    cloudBaseMslM <= terrainElevM ||
    (cloudBaseKey != null && numAt(hourly, cloudBaseKey, index) === 0);

  let ceilingFtAgl: number | null = null;
  if (aglM > 0) ceilingFtAgl = aglM * M_TO_FT;
  else if (obscured) ceilingFtAgl = 0;

  const ceilingCategory = ceilingCategoryFromFtAgl(ceilingFtAgl);

  return { ceilingFtAgl, ceilingCategory, cloudBaseMslM, obscured, method };
}

export function ceilingCategoryFromFtAgl(ceilingFtAgl: number | null): FlightCategory {
  if (ceilingFtAgl == null) return "VFR";
  return flightCategoryFromWx(null, ceilingFtAgl);
}

export function categoryColor(cat: FlightCategory): string {
  switch (cat) {
    case "VFR":
      return CEILING_LEGEND.VFR.color;
    case "MVFR":
      return CEILING_LEGEND.MVFR.color;
    case "IFR":
      return CEILING_LEGEND.IFR.color;
    case "LIFR":
      return CEILING_LEGEND.LIFR.color;
    default:
      return "#94a3b8";
  }
}