import { describe, expect, it } from "vitest";
import { airfieldMsa, annex3NscCeilingFtAgl, ANNEX3_NSC_MIN_FT } from "@/lib/andes/airfield-msa";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import { deriveMetarWxAndCloud } from "@/lib/andes/wmo-metar-wx";

describe("airfield MSA assumptions", () => {
  it("pins SCTB at the 25 NM AIP MSA of 20000 ft", () => {
    const row = airfieldMsa("SCTB");
    expect(row?.msaFtAmsl).toBe(20_000);
    expect(row?.assumption).toBe(false);
    expect(row?.citation).toMatch(/IAC 1/);
    expect(row?.citation).toMatch(/AMDT 100/);
    const elevFt = 649 * 3.280839895;
    expect(annex3NscCeilingFtAgl("SCTB", 649)).toBe(Math.max(ANNEX3_NSC_MIN_FT, 20_000 - elevFt));
  });

  it("SCTB NSC ceiling AGL is above default 5000 ft (Andes MSA)", () => {
    const ft = annex3NscCeilingFtAgl("SCTB", 649);
    expect(ft).toBeGreaterThan(ANNEX3_NSC_MIN_FT);
    expect(ft).toBeGreaterThanOrEqual(9_000);
  });

  it("SCVH keeps 9 500 ft as a labelled assumption (no AIP MSA)", () => {
    const row = airfieldMsa("SCVH");
    expect(row?.assumption).toBe(true);
    expect(row?.msaFtAmsl).toBe(9_500);
    expect(row?.citation).toMatch(/Chacabuco/);
    expect(row?.citation).toMatch(/ASSUMPTION/);
    expect(row?.citation).not.toMatch(/coastal sector as SCVM/i);
    const ft = annex3NscCeilingFtAgl("SCVH", 652);
    expect(ft).toBeGreaterThan(ANNEX3_NSC_MIN_FT);
    expect(ft).toBeGreaterThanOrEqual(7_000);
  });

  it("cites published AIP MSA for SCTB, SCEL, and SCVM", () => {
    expect(airfieldMsa("SCTB")).toMatchObject({ msaFtAmsl: 20_000, assumption: false });
    expect(airfieldMsa("SCEL")).toMatchObject({ msaFtAmsl: 19_000, assumption: false });
    expect(airfieldMsa("SCVM")).toMatchObject({ msaFtAmsl: 9_500, assumption: false });
    expect(airfieldMsa("SCPD")?.assumption).toBe(true);
    for (const icao of ["SCTB", "SCEL", "SCVM"] as const) {
      const row = airfieldMsa(icao);
      expect(row?.citation).toMatch(/AMDT/);
      expect(row?.citation).toMatch(/MSA/);
      expect(row?.citation).toMatch(/aipchile\.dgac\.gob\.cl/);
    }
  });

  it("dry spread with BKN low cloud at SCTB → BKN///, not NSC", () => {
    const hourly = {
      time: ["t"],
      temperature_2m: [25],
      dew_point_2m: [8],
      relative_humidity_2m: [40],
      cloud_cover_low: [90],
      surface_pressure: [980],
      cloud_cover_925hPa: [10],
      geopotential_height_925hPa: [800],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9999, false);
    expect(d.clouds).toBe("BKN///");
    expect(d.clouds).not.toBe("NSC");
  });
});