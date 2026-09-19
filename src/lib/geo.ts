import type { LatLon } from "./types";

const R_KM = 6371;

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

function toDeg(r: number) {
  return (r * 180) / Math.PI;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function interpolateGreatCircle(a: LatLon, b: LatLon, steps: number): LatLon[] {
  const points: LatLon[] = [];
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);
  const d = toRad(haversineKm(a, b) / R_KM) || 0.0001;

  for (let i = 0; i < steps; i += 1) {
    const f = steps === 1 ? 0 : i / (steps - 1);
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    points.push({ lat: toDeg(lat), lon: toDeg(lon) });
  }
  return points;
}

export const CHILE_BBOX = { minLat: -56.5, maxLat: -17.0, minLon: -76.5, maxLon: -66.0 };

export function inChileBbox(lat: number, lon: number): boolean {
  return (
    lat >= CHILE_BBOX.minLat &&
    lat <= CHILE_BBOX.maxLat &&
    lon >= CHILE_BBOX.minLon &&
    lon <= CHILE_BBOX.maxLon
  );
}

export const CHILE_COAST: LatLon[] = [
  { lat: -18.35, lon: -70.33 },
  { lat: -20.54, lon: -70.18 },
  { lat: -23.44, lon: -70.45 },
  { lat: -27.26, lon: -70.78 },
  { lat: -29.92, lon: -71.34 },
  { lat: -32.95, lon: -71.55 },
  { lat: -33.65, lon: -71.63 },
  { lat: -36.77, lon: -73.06 },
  { lat: -38.77, lon: -73.24 },
  { lat: -39.65, lon: -73.22 },
  { lat: -41.47, lon: -72.94 },
  { lat: -42.48, lon: -73.76 },
  { lat: -45.4, lon: -72.7 },
  { lat: -46.55, lon: -72.1 },
  { lat: -51.67, lon: -72.53 },
  { lat: -53.0, lon: -70.85 },
  { lat: -54.93, lon: -67.61 },
];
