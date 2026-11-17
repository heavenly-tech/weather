/** Linked altitude picker: flight levels (ft MSL) ↔ pressure (hPa) using ISA barometric formulas. */

import { PRESSURE_LEVELS } from "@/lib/andes/models";

const P0 = 1013.25;
const M_TO_FT = 3.280839895;

/** Pressure (hPa) to geopotential height (ft MSL), ISA. */
export function hpaToFtMsl(hpa: number): number {
  const heightM = 44330 * (1 - Math.pow(hpa / P0, 0.1903));
  return Math.round(heightM * M_TO_FT);
}

/** Feet MSL to pressure (hPa), ISA. */
export function ftMslToHpa(ftMsl: number): number {
  const heightM = ftMsl / M_TO_FT;
  const p = P0 * Math.pow(1 - heightM / 44330, 5.255);
  return Math.round(p);
}

export function nearestPressureLevel(hpa: number): (typeof PRESSURE_LEVELS)[number] {
  let best: (typeof PRESSURE_LEVELS)[number] = PRESSURE_LEVELS[0];
  let diff = Math.abs(hpa - best);
  for (const level of PRESSURE_LEVELS) {
    const d = Math.abs(hpa - level);
    if (d < diff) {
      best = level;
      diff = d;
    }
  }
  return best;
}

export const ALTITUDE_PRESETS_FT = [
  { ft: 3000, label: "3 000 ft" },
  { ft: 6000, label: "6 000 ft" },
  { ft: 10000, label: "10 000 ft" },
  { ft: 14000, label: "14 000 ft" },
  { ft: 18000, label: "FL180" },
] as const;