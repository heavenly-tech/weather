import { describe, expect, it } from "vitest";
import { airfieldMsaAssumption, annex3NscCeilingFtAgl, ANNEX3_NSC_MIN_FT } from "@/lib/andes/airfield-msa";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import { annex3NscEligible, deriveMetarWxAndCloud } from "@/lib/andes/wmo-metar-wx";

describe("airfield MSA assumptions", () => {
  it("SCTB NSC ceiling AGL is above default 5000 ft (Andes MSA)", () => {
    const ft = annex3NscCeilingFtAgl("SCTB", 649);
    expect(ft).toBeGreaterThan(ANNEX3_NSC_MIN_FT);
    expect(ft).toBeGreaterThanOrEqual(9_000);
  });

  it("SCVH MSA 9 500 ft AMSL (Chacabuco ASSUMPTION, not coastal SCVM)", () => {
    const row = airfieldMsaAssumption("SCVH");
    expect(row?.msaFtAmslAssumed).toBe(9_500);
    expect(row?.note).toMatch(/Chacabuco|SCPD/i);
    expect(row?.note).not.toMatch(/SCVM|coastal sector as SCVM/i);
    const ft = annex3NscCeilingFtAgl("SCVH", 120);
    expect(ft).toBeGreaterThan(ANNEX3_NSC_MIN_FT);
    expect(ft).toBeGreaterThanOrEqual(8_000);
  });

  it("dry spread with BKN low cloud at SCTB → MID CLD BASE UNK, not NSC", () => {
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
    expect(annex3NscEligible(hourly, 0, 649, "SCTB")).toBe(false);
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9999, false);
    expect(d.clouds).toBe("////");
    expect(d.rmkExtra).toContain("MID CLD BASE UNK");
    expect(d.clouds).not.toBe("NSC");
  });
});