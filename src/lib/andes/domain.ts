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

/** Default ~0.1° spacing (27×18 ≈ 486 points). Override via ANDES_GRID_ROWS / ANDES_GRID_COLS. */
export function defaultGridShape(): { rows: number; cols: number } {
  const rows = Number(process.env.ANDES_GRID_ROWS ?? 18);
  const cols = Number(process.env.ANDES_GRID_COLS ?? 27);
  return {
    rows: Number.isFinite(rows) && rows >= 4 ? rows : 18,
    cols: Number.isFinite(cols) && cols >= 4 ? cols : 27,
  };
}

export function domainGrid(rows?: number, cols?: number): GridPoint[] {
  const shape = defaultGridShape();
  const r = rows ?? shape.rows;
  const c = cols ?? shape.cols;
  const points: GridPoint[] = [];
  for (let ri = 0; ri < r; ri++) {
    const lat = ANDES_DOMAIN.latMax + (ri / Math.max(1, r - 1)) * (ANDES_DOMAIN.latMin - ANDES_DOMAIN.latMax);
    for (let ci = 0; ci < c; ci++) {
      const lon = ANDES_DOMAIN.lonMin + (ci / Math.max(1, c - 1)) * (ANDES_DOMAIN.lonMax - ANDES_DOMAIN.lonMin);
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