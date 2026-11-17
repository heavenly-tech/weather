/**
 * Ceiling derivation for the Andes ceiling map (ft AGL above local terrain).
 *
 * ## Algorithm
 *
 * 1. **Underground filter** — Skip levels with pressure > `surface_pressure` or
 *    geopotential height ≤ terrain (SCEL ~957 hPa; 1000/975 hPa artefacts).
 * 2. **Stratiform base (primary)** — Walk levels above ground. Where layer cloud
 *    cover crosses **62.5 %** (BKN/OVC proxy), **linearly interpolate** base height
 *    between the level below and above (in height vs cover). RH ≥ 87 % applies only
 *    when cloud cover at that level is **missing**. The surface floor uses cover **0**,
 *    never the column-integrated `cloud_cover_low`.
 * 3. **ICON `convective_cloud_base`** — Documented as **m ASL** (not AGL). Values
 *    ≤ 0 or ≤ −500 are ignored. Never added to terrain. Does **not** override the
 *    pressure-level scan; we take the **lower** (more conservative) base MSL when
 *    both exist and convective cover is BKN+.
 * 4. **AGL** — `(baseMslM - terrainElevM)`, never negative for category; **null** = no ceiling.
 * 5. **Obscuration** — True when interpolated base MSL ≤ terrain elevation (peak inside cloud).
 * 6. **Map category** — Uses ceiling ft AGL **and** model visibility when available
 *    (`flightCategoryFromWx`); label as *ceiling category* when vis is missing.
 */

import type { FlightCategory } from "@/lib/types";
import { flightCategoryFromWx } from "@/lib/visibility";

export const BKN_CLOUD_COVER_PCT = 62.5;
export const LOW_CLOUD_GATE_PCT = 50;
const M_TO_FT = 3.280839895;
const P0 = 1013.25;
const OBSCURATION_EPS_M = 5;

export const CEILING_LEGEND = {
  VFR: { minFtAgl: 3000, label: "VFR", color: "#22c55e" },
  MVFR: { minFtAgl: 1000, maxFtAgl: 3000, label: "MVFR", color: "#38bdf8" },
  IFR: { minFtAgl: 500, maxFtAgl: 999, label: "IFR", color: "#fbbf24" },
  LIFR: { maxFtAgl: 499, label: "LIFR", color: "#f87171" },
} as const;

export type CeilingSample = {
  ceilingFtAgl: number | null;
  ceilingCategory: FlightCategory;
  cloudBaseMslM: number | null;
  obscured: boolean;
  /** Low-layer cover without a resolved BKN base — not a ceiling height. */
  lowCloudUnresolved: boolean;
  method: "cloud_base_field" | "pressure_level" | "interpolated" | "unlimited" | "fog";
  visM: number | null;
};

type Hourly = Record<string, Array<number | null> | string[]>;

const LEVELS_DESC = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300];

function numAt(hourly: Hourly | undefined, key: string, index: number): number | null {
  const series = hourly?.[key];
  if (!series) return null;
  const value = series[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function surfacePressureHpa(hourly: Hourly, index: number, terrainElevM: number): number {
  const sp = numAt(hourly, "surface_pressure", index);
  if (sp != null && sp > 400 && sp < 1100) return sp;
  return P0 * Math.pow(1 - terrainElevM / 44330, 5.255);
}

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

type LevelSample = { hpa: number; heightM: number; cover: number | null; rh: number | null };

function collectLevelsAboveGround(
  hourly: Hourly,
  index: number,
  terrainElevM: number,
  surfaceHpa: number
): LevelSample[] {
  const out: LevelSample[] = [];
  for (const hpa of LEVELS_DESC) {
    if (hpa > surfaceHpa) continue;
    const hM = numAt(hourly, `geopotential_height_${hpa}hPa`, index);
    if (!pressureLevelAboveTerrain(hpa, hM, terrainElevM, surfaceHpa) || hM == null) continue;
    out.push({
      hpa,
      heightM: hM,
      cover: numAt(hourly, `cloud_cover_${hpa}hPa`, index),
      rh: numAt(hourly, `relative_humidity_${hpa}hPa`, index),
    });
  }
  out.sort((a, b) => a.heightM - b.heightM);
  return out;
}

/** Interpolate height where cover crosses BKN threshold between surface and first level, or between levels. */
export function interpolateCloudBaseMsl(
  hourly: Hourly,
  index: number,
  terrainElevM: number,
  surfaceHpa: number
): { baseMslM: number | null; method: "interpolated" | "unlimited"; lowCloudUnresolved: boolean } {
  const levels = collectLevelsAboveGround(hourly, index, terrainElevM, surfaceHpa);
  const lowCover = numAt(hourly, "cloud_cover_low", index);

  const floor: LevelSample = {
    hpa: Math.round(surfaceHpa),
    heightM: terrainElevM,
    cover: 0,
    rh: numAt(hourly, "relative_humidity_2m", index),
  };

  const chain: LevelSample[] = [floor, ...levels];

  for (let i = 1; i < chain.length; i++) {
    const below = chain[i - 1]!;
    const above = chain[i]!;
    const c0 = below.cover ?? (below.rh != null && below.rh >= 87 ? BKN_CLOUD_COVER_PCT - 1 : 0);
    const c1 = above.cover ?? (above.rh != null && above.rh >= 87 ? BKN_CLOUD_COVER_PCT : 0);

    if (above.cover == null && above.rh != null && above.rh >= 87 && below.cover != null && below.cover < BKN_CLOUD_COVER_PCT) {
      /* RH-only assist when cover missing at this level */
    } else if (above.cover != null && above.cover < BKN_CLOUD_COVER_PCT) {
      continue;
    }

    if (c1 >= BKN_CLOUD_COVER_PCT) {
      if (c0 >= BKN_CLOUD_COVER_PCT && below.hpa < 1000) {
        return { baseMslM: below.heightM, method: "interpolated", lowCloudUnresolved: false };
      }
      if (c1 === c0) {
        return { baseMslM: above.heightM, method: "interpolated", lowCloudUnresolved: false };
      }
      const frac = (BKN_CLOUD_COVER_PCT - c0) / (c1 - c0);
      const h = below.heightM + frac * (above.heightM - below.heightM);
      return { baseMslM: Math.max(terrainElevM, h), method: "interpolated", lowCloudUnresolved: false };
    }
  }

  const lowUnresolved = lowCover != null && lowCover >= LOW_CLOUD_GATE_PCT;
  return { baseMslM: null, method: "unlimited", lowCloudUnresolved: lowUnresolved };
}

function iconConvectiveBaseMsl(hourly: Hourly, index: number): number | null {
  const cb = numAt(hourly, "convective_cloud_base", index);
  if (cb == null || cb <= 0 || cb <= -500) return null;
  const showers = numAt(hourly, "showers", index) ?? 0;
  const cape = numAt(hourly, "cape", index);
  const low = numAt(hourly, "cloud_cover_low", index) ?? 0;
  const convective =
    showers >= 0.1 || (cape != null && cape >= 100) || low >= BKN_CLOUD_COVER_PCT;
  if (!convective) return null;
  return cb;
}

function visibilityM(hourly: Hourly, index: number): number | null {
  const v = numAt(hourly, "visibility", index);
  return v != null ? v : null;
}

function fogBaseMsl(
  hourly: Hourly,
  index: number,
  terrainElevM: number,
  surfaceHpa: number,
  visM: number | null
): number | null {
  const rh2 = numAt(hourly, "relative_humidity_2m", index);
  const levels = collectLevelsAboveGround(hourly, index, terrainElevM, surfaceHpa);
  const lowest = levels[0];
  const fogVis = visM != null && visM < 1000;
  const moistSurface =
    rh2 != null &&
    rh2 >= 97 &&
    lowest != null &&
    (lowest.cover ?? 0) >= BKN_CLOUD_COVER_PCT &&
    lowest.heightM - terrainElevM <= 80;
  if (fogVis || moistSurface) return terrainElevM;
  return null;
}

export function ceilingFromHourly(hourly: Hourly, index: number, terrainElevM: number): CeilingSample {
  const surfaceHpa = surfacePressureHpa(hourly, index, terrainElevM);
  const visM = visibilityM(hourly, index);

  const strat = interpolateCloudBaseMsl(hourly, index, terrainElevM, surfaceHpa);
  const convMsl = iconConvectiveBaseMsl(hourly, index);
  const fogMsl = fogBaseMsl(hourly, index, terrainElevM, surfaceHpa, visM);

  let cloudBaseMslM: number | null = strat.baseMslM;
  let method: CeilingSample["method"] = strat.method;

  if (fogMsl != null && (cloudBaseMslM == null || fogMsl < cloudBaseMslM)) {
    cloudBaseMslM = fogMsl;
    method = "fog";
  }

  if (convMsl != null) {
    if (cloudBaseMslM == null || convMsl < cloudBaseMslM) {
      cloudBaseMslM = convMsl;
      method = "cloud_base_field";
    }
  }

  if (cloudBaseMslM == null) {
    return {
      ceilingFtAgl: null,
      ceilingCategory: flightCategoryFromWx(visM, null),
      cloudBaseMslM: null,
      obscured: false,
      lowCloudUnresolved: strat.lowCloudUnresolved,
      method: "unlimited",
      visM,
    };
  }

  const obscured = cloudBaseMslM <= terrainElevM + OBSCURATION_EPS_M;
  const aglM = cloudBaseMslM - terrainElevM;
  const ceilingFtAgl = aglM > 0 ? aglM * M_TO_FT : null;

  const ceilingCategory = flightCategoryFromWx(visM, ceilingFtAgl);

  return {
    ceilingFtAgl,
    ceilingCategory,
    cloudBaseMslM,
    obscured,
    lowCloudUnresolved: false,
    method,
    visM,
  };
}

export function ceilingCategoryFromFtAgl(ceilingFtAgl: number | null, visM: number | null = null): FlightCategory {
  return flightCategoryFromWx(visM, ceilingFtAgl);
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