import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/taf-hourly.json";
import { generateModelMetar, metarDdhhmmZ, STAMP } from "@/lib/andes/wmo-metar";

describe("generateModelMetar", () => {
  it("uses DDHHMMZ, stamp first, dewpoint and QNH groups", () => {
    const raw = generateModelMetar({
      icao: "SCEL",
      elevM: 474,
      model: "gfs_seamless",
      runTime: "2026-11-17T12:00:00Z",
      validTime: "2026-11-17T18:30:00Z",
      hourly: {
        ...fixture.hourly,
        dew_point_2m: [8],
        pressure_msl: [1013.2],
        visibility: [8000],
      } as Record<string, Array<number | null> | string[]>,
      hourIndex: 0,
    });
    expect(raw.raw.startsWith(STAMP)).toBe(true);
    expect(metarDdhhmmZ("2026-11-17T18:30:00Z")).toBe("171830Z");
    expect(raw.raw).toContain("171830Z");
    expect(raw.raw).not.toContain("AUTO");
    expect(raw.raw).toMatch(/Q1013/);
    expect(raw.raw).toMatch(/\d{2}\/\d{2}/);
  });
});