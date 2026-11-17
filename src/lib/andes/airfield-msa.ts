/**
 * Conservative minimum-sector altitude (MSA) assumptions for Annex 3 NSC.
 * **NOT official AIP data** — desk / model-product assumptions only.
 *
 * Sources: not fetched from AIP in this build. Values are deliberately
 * conservative (higher MSA = harder to claim NSC) for terrain near each field.
 * Replace with chart-cited values when AIP extracts land in repo.
 */

import { ANDES_AIRFIELDS } from "@/lib/andes/airfields";

const M_TO_FT = 3.280839895;

/** Annex 3: NSC only if no significant cloud below max(5000 ft, MSA). */
export const ANNEX3_NSC_MIN_FT = 5000;

export type AirfieldMsaAssumption = {
  icao: string;
  /** Conservative MSA AMSL in feet (assumed, not from live AIP fetch). */
  msaFtAmslAssumed: number;
  note: string;
};

/**
 * ASSUMPTION table — conservative MSA (ft AMSL) for low-cloud / NSC gating.
 *
 * TODO: Replace every row with cited AIP / approach-chart MSA values once extracts
 * are committed in-repo (ICAO doc 8697 Annex 3 NSC gating).
 */
export const AIRFIELD_MSA_ASSUMPTIONS: AirfieldMsaAssumption[] = [
  {
    icao: "SCTB",
    msaFtAmslAssumed: 11_500,
    note: "ASSUMPTION: Santiago cordillera sector; Tobalaba private strip — not an AIP MSA extract.",
  },
  {
    icao: "SCEL",
    msaFtAmslAssumed: 6_200,
    note: "ASSUMPTION: SCEL basin; higher terrain east within MSA ring.",
  },
  {
    icao: "SCVM",
    msaFtAmslAssumed: 5_200,
    note: "ASSUMPTION: Coastal aerodrome; MSA slightly above 5 000 ft floor.",
  },
  {
    icao: "SCVH",
    msaFtAmslAssumed: 9_500,
    note:
      "ASSUMPTION (conservative): inland Chacabuco valley; same sector as SCPD — coastal range (Cerro El Roble ~2 200 m) west, Andes east.",
  },
  {
    icao: "SCPD",
    msaFtAmslAssumed: 9_500,
    note: "ASSUMPTION (conservative): Peldehue piedmont; pre-cordillera sector.",
  },
];

const MSA_BY_ICAO = new Map(AIRFIELD_MSA_ASSUMPTIONS.map((r) => [r.icao, r]));

/** Lowest altitude (ft AGL) below which Annex 3 NSC requires no BKN/OVC. */
export function annex3NscCeilingFtAgl(icao: string, elevM: number): number {
  const row = MSA_BY_ICAO.get(icao.toUpperCase());
  const msaAmsl = row?.msaFtAmslAssumed ?? ANNEX3_NSC_MIN_FT;
  const msaAgl = Math.max(0, msaAmsl - elevM * M_TO_FT);
  return Math.max(ANNEX3_NSC_MIN_FT, msaAgl);
}

export function airfieldMsaAssumption(icao: string): AirfieldMsaAssumption | undefined {
  return MSA_BY_ICAO.get(icao.toUpperCase());
}

export function allAirfieldMsaAssumptions(): AirfieldMsaAssumption[] {
  return ANDES_AIRFIELDS.map((a) => MSA_BY_ICAO.get(a.icao)).filter(Boolean) as AirfieldMsaAssumption[];
}