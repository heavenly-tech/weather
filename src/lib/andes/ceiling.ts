/**
 * Ceiling derivation for the Andes ceiling map (ft AGL above local terrain).
 *
 * ## Algorithm (documented for scoring / briefing review)
 *
 * 1. **Direct cloud-base fields** — When Open-Meteo returns `convective_cloud_base` or
 *    `cloud_base` (metres above ground / model surface), take the lowest non-null value
 *    as a candidate ceiling.
 *
 * 2. **Pressure-level cloud cover (BKN/OVC proxy)** — Aviation defines a ceiling as the
 *    lowest BKN, OVC, or VV layer. On a gridded model we treat **≥ 62.5 %** layer cloud
 *    cover (5/8) as BKN/OVC at that pressure level. Levels are scanned from the surface
 *    upward (1000 hPa → 300 hPa). The **lowest** qualifying level sets the cloud base MSL
 *    via `geopotential_height_*hPa`.
 *
 * 3. **Relative humidity assist** — If cloud cover is missing at a level but RH ≥ 87 %,
 *    that level is also treated as moist/cloudy (common when only RH is exported).
 *
 * 4. **AGL conversion** — `ceilingFtAgl = (baseMslM - terrainElevM) * 3.28084`. Unlimited
 *    / no ceiling is represented as `null` (VFR sky).
 *
 * 5. **Flight category** — FAA buckets on ceiling **ft AGL**: VFR > 3000; MVFR 1000–3000;
 *    IFR 500–<1000; LIFR < 500 (see `ceilingCategoryFromFtAgl`).
 *
 * 6. **Mountain obscuration** — Where the cloud base MSL is at or below the terrain
 *    elevation, or a qualifying cloud layer height is below terrain, the cell is flagged
 *    `obscured` (terrain intersects the cloud layer).
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

export function ceilingFromHourly(
  hourly: Hourly,
  index: number,
  terrainElevM: number,
  cloudBaseKey: string | null
): CeilingSample {
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
      const cover = numAt(hourly, `cloud_cover_${hpa}hPa`, index);
      const rh = numAt(hourly, `relative_humidity_${hpa}hPa`, index);
      const moist = (cover != null && cover >= BKN_CLOUD_COVER_PCT) || (rh != null && rh >= 87);
      if (!moist) continue;
      const hM = numAt(hourly, `geopotential_height_${hpa}hPa`, index);
      if (hM == null) continue;
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
  const ceilingFtAgl = Math.max(0, aglM * M_TO_FT);
  const obscured = aglM <= 0 || cloudBaseMslM <= terrainElevM;
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