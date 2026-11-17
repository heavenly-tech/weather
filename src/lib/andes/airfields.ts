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
  /**
   * Observation used when this field has no METAR.
   * Omit for a model-only field that is not checked against an observation.
   */
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
    // ARP 33°03'03"S 70°42'32"W, elev 2139 ft / 652 m.
    // DGAC AIP Chile VAC SCVH, AD La Victoria de Chacabuco (AD 3), AMDT 62, effective 28 NOV 2024.
    // https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/ais/3%20AD%20Parte%203/AD%203%20VAC/04%20VAC%20SCVH%20AD%20La%20Victoria%20de%20Chacabuco%20-%20Colina.pdf
    // No METAR: model-only, not verified against an observation. About 26 NM north of SCTB.
    icao: "SCVH",
    name: "La Victoria de Chacabuco",
    lat: -(33 + 3 / 60 + 3 / 3600),
    lon: -(70 + 42 / 60 + 32 / 3600),
    elevM: 652,
    hasMetar: false,
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