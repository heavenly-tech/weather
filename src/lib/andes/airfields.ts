/** Airfields for the Andes Step-1 viewer (may extend STATIONS). */

import { haversineKm } from "@/lib/geo";
import type { LatLon } from "@/lib/types";

export type AndesAirfield = {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevM: number;
  hasMetar: boolean;
  /** When false, timelines use nearestMetarIcao */
  nearestMetarIcao?: string;
};

export const ANDES_AIRFIELDS: AndesAirfield[] = [
  {
    icao: "SCTB",
    name: "Eulogio Sánchez / Tobalaba",
    lat: -33.456,
    lon: -70.546,
    elevM: 649,
    hasMetar: false,
    nearestMetarIcao: "SCEL",
  },
  {
    icao: "SCEL",
    name: "Arturo Merino Benítez",
    lat: -33.393,
    lon: -70.786,
    elevM: 474,
    hasMetar: true,
  },
  {
    icao: "SCVM",
    name: "Viña del Mar / Torquemada",
    lat: -32.95,
    lon: -71.479,
    elevM: 141,
    hasMetar: true,
  },
  {
    icao: "SCVH",
    name: "Viña del Mar heliport",
    lat: -33.045,
    lon: -71.541,
    elevM: 120,
    hasMetar: false,
    nearestMetarIcao: "SCVM",
  },
  {
    icao: "SCPD",
    name: "Peldehue",
    lat: -33.117,
    lon: -70.684,
    elevM: 360,
    hasMetar: true,
  },
];

export function andesAirfield(icao: string): AndesAirfield | undefined {
  return ANDES_AIRFIELDS.find((a) => a.icao === icao.toUpperCase());
}

export function nearestMetarProxy(
  field: AndesAirfield,
  candidates: { icao: string; lat: number; lon: number }[]
): { icao: string; distanceKm: number } | null {
  if (field.hasMetar) return null;
  const preferred = field.nearestMetarIcao;
  if (preferred) {
    const c = candidates.find((x) => x.icao === preferred);
    if (c) {
      return {
        icao: c.icao,
        distanceKm: haversineKm(field, c),
      };
    }
  }
  let best: { icao: string; distanceKm: number } | null = null;
  for (const c of candidates) {
    const d = haversineKm(field, c);
    if (!best || d < best.distanceKm) best = { icao: c.icao, distanceKm: d };
  }
  return best;
}

export function observationPoint(field: AndesAirfield): LatLon {
  return { lat: field.lat, lon: field.lon };
}