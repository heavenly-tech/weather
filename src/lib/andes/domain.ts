/** Central-Chile Andes domain centred on SCTB (Tobalaba). */

export const ANDES_DOMAIN = {
  latMin: -34.8,
  latMax: -32.1,
  lonMin: -71.8,
  lonMax: -70.0,
} as const;

export const SCTB_FOCUS = { lat: -33.456, lon: -70.546, icao: "SCTB" as const };

export const TIMELINE_AIRFIELDS = ["SCTB", "SCEL", "SCVH", "SCPD"] as const;

export type TimelineAirfield = (typeof TIMELINE_AIRFIELDS)[number];

export type GridPoint = { lat: number; lon: number; elevM: number };

/** Coarse grid for map overlays (Open-Meteo multi-point limits apply). */
export function domainGrid(rows = 9, cols = 10): GridPoint[] {
  const points: GridPoint[] = [];
  for (let r = 0; r < rows; r++) {
    const lat = ANDES_DOMAIN.latMax + (r / Math.max(1, rows - 1)) * (ANDES_DOMAIN.latMin - ANDES_DOMAIN.latMax);
    for (let c = 0; c < cols; c++) {
      const lon = ANDES_DOMAIN.lonMin + (c / Math.max(1, cols - 1)) * (ANDES_DOMAIN.lonMax - ANDES_DOMAIN.lonMin);
      points.push({ lat, lon, elevM: 0 });
    }
  }
  return points;
}

export function inDomain(lat: number, lon: number): boolean {
  return (
    lat >= ANDES_DOMAIN.latMin &&
    lat <= ANDES_DOMAIN.latMax &&
    lon >= ANDES_DOMAIN.lonMin &&
    lon <= ANDES_DOMAIN.lonMax
  );
}