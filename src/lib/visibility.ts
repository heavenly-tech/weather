import type { CloudLayer, FlightCategory } from "./types";

const SM_TO_M = 1609.344;
const VFR_VIS_M = 5 * SM_TO_M;
const MVFR_VIS_M = 3 * SM_TO_M;
const IFR_VIS_M = 1 * SM_TO_M;

/** Lowest BKN/OVC/VV base, or null when there is no ceiling. */
export function ceilingFtFromClouds(clouds: CloudLayer[]): number | null {
  const bases = clouds
    .filter((c) => {
      const cover = c.cover.toUpperCase();
      return (cover === "BKN" || cover === "OVC" || cover === "VV") && c.baseFt != null;
    })
    .map((c) => c.baseFt as number);
  if (!bases.length) return null;
  return Math.min(...bases);
}

/**
 * ICAO prevailing visibility from a raw METAR/TAF group.
 * Prefers CAVOK / the four-digit metre group after the wind, not QNH or cloud bases.
 */
export function parseIcaoVisMFromRaw(raw: string | null | undefined): number | null {
  if (!raw) return null;
  if (/\bCAVOK\b/.test(raw)) return 9999;

  const afterWind = raw.match(/(?:VRB|\d{3})(?:\d{2,3})(?:G\d{2,3})?(?:KT|MPS|KMH)\s+([A-Z0-9/+\s]+)/i);
  const slice = afterWind?.[1] ?? raw;
  if (/\bCAVOK\b/.test(slice)) return 9999;

  const vis = slice.match(/\b(\d{4})(?:NDV|[NSEW]{1,2})?\b/);
  if (!vis) return null;
  const meters = Number(vis[1]);
  if (!Number.isFinite(meters) || meters > 9999) return null;
  return meters;
}

/**
 * AWC `visib` is statute miles (`6+`, `3.11`). Convert to ICAO metres and snap
 * to the usual reporting steps so 3.11 SM becomes 5000 m, not 5005.
 */
export function awcVisToMeters(visib: string | number | null | undefined): number | null {
  if (visib == null || visib === "") return null;
  const s = String(visib).trim();
  if (s === "6+" || /^P6/i.test(s)) return 9999;
  const sm = Number(s);
  if (!Number.isFinite(sm) || sm < 0) return null;
  const meters = sm * SM_TO_M;
  if (meters >= 9990) return 9999;
  if (meters < 800) return Math.round(meters / 50) * 50;
  if (meters < 5000) return Math.round(meters / 100) * 100;
  return Math.min(9999, Math.round(meters / 1000) * 1000);
}

export function resolveVisM(
  raw: string | null | undefined,
  awcVisib: string | number | null | undefined
): number | null {
  return parseIcaoVisMFromRaw(raw) ?? awcVisToMeters(awcVisib);
}

export function formatVisM(meters: number | null | undefined): string {
  if (meters == null || Number.isNaN(meters)) return "—";
  return `${meters} m`;
}

/** FAA/AWC flight-category thresholds, evaluated in metres / feet. */
export function flightCategoryFromWx(
  visM: number | null | undefined,
  ceilingFt: number | null | undefined
): FlightCategory {
  const vis = visM ?? Number.POSITIVE_INFINITY;
  const ceil = ceilingFt ?? Number.POSITIVE_INFINITY;
  if (ceil < 500 || vis < IFR_VIS_M) return "LIFR";
  if (ceil < 1000 || vis < MVFR_VIS_M) return "IFR";
  if (ceil <= 3000 || vis <= VFR_VIS_M) return "MVFR";
  return "VFR";
}

export function vfrSvfrHref(icao?: string | null): string {
  const id = (icao ?? "").trim().toUpperCase();
  return id ? `/vfr-svfr?icao=${encodeURIComponent(id)}` : "/vfr-svfr";
}
