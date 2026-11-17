/**
 * Minimum sector altitude used for Annex 3 NSC gating.
 *
 * Published figures are the single MSA value printed in the 25 NM circle on
 * the DGAC AIP Chile approach chart (not a sector split). Where the AIP has
 * no instrument approach and no MSA, the previous conservative assumption is
 * kept and labelled.
 *
 * Charts read from https://aipchile.dgac.gob.cl/ (AIP Chile VOL II / AD 3 VAC).
 */

import { ANDES_AIRFIELDS } from "@/lib/andes/airfields";

const M_TO_FT = 3.280839895;

/** Annex 3: NSC only if no significant cloud below max(5000 ft, MSA). */
export const ANNEX3_NSC_MIN_FT = 5000;

export type AirfieldMsaRecord = {
  icao: string;
  /** MSA AMSL in feet. Published AIP value, or a labelled assumption. */
  msaFtAmsl: number;
  /** True when DGAC has not published an MSA for this aerodrome. */
  assumption: boolean;
  /** AIP chart or VAC, amendment, and effective date. */
  citation: string;
};

/**
 * SCTB, SCEL, and SCVM use the MSA printed on the current AIP approach chart.
 * SCVH and SCPD are VFR AD 3 aerodromes with a VAC and no IAC, so no MSA.
 */
export const AIRFIELD_MSA: AirfieldMsaRecord[] = [
  {
    icao: "SCTB",
    msaFtAmsl: 20_000,
    assumption: false,
    citation:
      "AIP Chile VOL II SCTB IAC 1 RNP RWY 01 (LNAV only): MSA 25 NM RW01 = 20000 ft. DGAC AMDT 100, effective 07 AUG 2025. https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/aipmap/SCTB/SCTB%20IAC1.pdf",
  },
  {
    icao: "SCEL",
    msaFtAmsl: 19_000,
    assumption: false,
    citation:
      "AIP Chile VOL II SCEL IAC 2 ILS Z RWY 17R: MSA 25 NM AMB = 19000 ft. DGAC AMDT 103, effective 06 AUG 2026. Same figure on SCEL IAC 1. https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/aipmap/SCEL/SCEL%20IAC2.pdf",
  },
  {
    icao: "SCVM",
    msaFtAmsl: 9_500,
    assumption: false,
    citation:
      "AIP Chile VOL II SCVM IAC 2 ILS Y o LOC Y RWY 05: MSA 25 NM SAL = 9500 ft. DGAC AMDT 98, effective 28 NOV 2024. Same figure on SCVM IAC 1. https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/aipmap/SCVM/SCVM%20IAC2.pdf",
  },
  {
    icao: "SCVH",
    msaFtAmsl: 9_500,
    assumption: true,
    citation:
      "ASSUMPTION — no published MSA. AIP Chile AD 3 La Victoria de Chacabuco (SCVH) is VFR; VAC AMDT 62 effective 28 NOV 2024 has terrain and circuit altitudes only, and aipmap has no SCVH IAC. 9500 ft AMSL kept as a conservative sector (Andes east of the Chacabuco valley). https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/ais/3%20AD%20Parte%203/AD%203%20VAC/04%20VAC%20SCVH%20AD%20La%20Victoria%20de%20Chacabuco%20-%20Colina.pdf",
  },
  {
    icao: "SCPD",
    msaFtAmsl: 9_500,
    assumption: true,
    citation:
      "ASSUMPTION — no published MSA. AIP Chile AD 3 Peldehue (SCPD) is VFR; VAC AMDT 67 effective 06 AUG 2026 has no MSA circle, and aipmap has no SCPD IAC. 9500 ft AMSL kept for the same pre-cordillera sector as SCVH. https://ftp2.dgac.gob.cl/dasa/aip_chile_con_contenido/ais/3%20AD%20Parte%203/AD%203%20VAC/05%20VAC%20SCPD%20AD%20Peldehue%20-%20Colina.pdf",
  },
];

/** @deprecated Use AIRFIELD_MSA. Kept so older imports still resolve. */
export const AIRFIELD_MSA_ASSUMPTIONS = AIRFIELD_MSA;

const MSA_BY_ICAO = new Map(AIRFIELD_MSA.map((row) => [row.icao, row]));

/** Lowest altitude (ft AGL) below which Annex 3 NSC requires no BKN/OVC. */
export function annex3NscCeilingFtAgl(icao: string, elevM: number): number {
  const row = MSA_BY_ICAO.get(icao.toUpperCase());
  const msaAmsl = row?.msaFtAmsl ?? ANNEX3_NSC_MIN_FT;
  const msaAgl = Math.max(0, msaAmsl - elevM * M_TO_FT);
  return Math.max(ANNEX3_NSC_MIN_FT, msaAgl);
}

export function airfieldMsa(icao: string): AirfieldMsaRecord | undefined {
  return MSA_BY_ICAO.get(icao.toUpperCase());
}

/** @deprecated Use airfieldMsa. */
export function airfieldMsaAssumption(icao: string): AirfieldMsaRecord | undefined {
  return airfieldMsa(icao);
}

export function allAirfieldMsaAssumptions(): AirfieldMsaRecord[] {
  return ANDES_AIRFIELDS.map((field) => MSA_BY_ICAO.get(field.icao)).filter((row): row is AirfieldMsaRecord => row != null);
}
