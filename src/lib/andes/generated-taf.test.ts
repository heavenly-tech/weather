import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/taf-hourly.json";
import { generateModelTaf } from "@/lib/andes/generated-taf";
import { assertModelTafFormat } from "@/lib/andes/taf-format";

describe("generateModelTaf", () => {
  it("includes stamp, header, validity, BECMG/TEMPO/PROB and in-validity change times", () => {
    const { raw, stamp } = generateModelTaf({
      icao: "SCEL",
      elevM: 474,
      model: "gfs_seamless",
      runTime: "2026-11-17T12:00:00Z",
      hourly: fixture.hourly as Record<string, Array<number | null> | string[]>,
      cloudBaseKey: null,
    });

    expect(stamp).toBe("MODEL OUTPUT — NOT OFFICIAL");
    expect(raw).toContain("TAF SCEL");
    expect(raw).toMatch(/\d{4}\/\d{4}/);
    expect(raw).toContain("BECMG");
    expect(raw).toContain("TEMPO");
    expect(raw).toContain("PROB30");
    const check = assertModelTafFormat(raw);
    expect(check.ok, check.ok ? "" : check.reasons.join("; ")).toBe(true);
  });
});