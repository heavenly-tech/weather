import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/taf-hourly.json";
import { generateModelTaf } from "@/lib/andes/generated-taf";
import { assertModelTafFormat } from "@/lib/andes/taf-format";
import { STAMP } from "@/lib/andes/wmo-metar";

describe("generateModelTaf", () => {
  it("Annex 3 header, stamp-first, BECMG/TEMPO/PROB when criteria met", () => {
    const result = generateModelTaf({
      icao: "SCEL",
      elevM: 474,
      model: "gfs_seamless",
      runTime: "2026-11-17T11:00:00Z",
      hourly: fixture.hourly as Record<string, Array<number | null> | string[]>,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.raw.startsWith(STAMP)).toBe(true);
    expect(result.raw).toMatch(/\d{6}Z/);
    expect(result.raw).toContain("TAF SCEL");
    const check = assertModelTafFormat(result.raw);
    expect(check.ok, check.ok ? "" : check.reasons.join("; ")).toBe(true);
  });
});