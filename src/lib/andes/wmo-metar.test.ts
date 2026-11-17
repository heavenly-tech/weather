import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/taf-hourly.json";
import { formatModelWind, generateModelMetar, metarDdhhmmZ, STAMP } from "@/lib/andes/wmo-metar";

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

  it("formats gust as dddffGfgKT and orders wind before visibility before weather", () => {
    const wind = formatModelWind(352, 30, 60);
    expect(wind).toBe("35016G32KT");
    const raw = generateModelMetar({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-10T06:00:00Z",
      validTime: "2026-11-10T06:00:00Z",
      hourly: {
        time: ["2026-11-10T06:00"],
        temperature_2m: [-2.4],
        dew_point_2m: [-3.6],
        pressure_msl: [1021.7],
        wind_direction_10m: [352],
        wind_speed_10m: [30],
        wind_gusts_10m: [60],
        visibility: [2400],
        weather_code: [63],
        surface_pressure: [980],
      },
      hourIndex: 0,
    });
    const line = raw.raw.split("\n")[1] ?? "";
    const visIdx = line.indexOf("2400");
    const wxIdx = line.indexOf("RA");
    expect(visIdx).toBeGreaterThan(-1);
    expect(wxIdx).toBeGreaterThan(visIdx);
    expect(line).toContain("35016G32KT");
  });
});