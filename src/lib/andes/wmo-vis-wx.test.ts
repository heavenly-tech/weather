import { describe, expect, it } from "vitest";
import { generateModelTaf } from "@/lib/andes/wmo-taf";
import { deriveMetarWxAndCloud } from "@/lib/andes/wmo-metar-wx";
import { visObscurationWx } from "@/lib/andes/wmo-vis-wx";
import { ceilingFromHourly } from "@/lib/andes/ceiling";

describe("visObscurationWx", () => {
  it("800 m → FG", () => {
    expect(visObscurationWx(800, 70)).toBe("FG");
  });
  it("3000 m RH 85% → BR", () => {
    expect(visObscurationWx(3000, 85)).toBe("BR");
  });
  it("3000 m RH 60% → HZ", () => {
    expect(visObscurationWx(3000, 60)).toBe("HZ");
  });
});

describe("METAR/TAF vis wx integration", () => {
  const base = {
    time: ["t"],
    temperature_2m: [12],
    dew_point_2m: [10],
    cloud_cover_low: [90],
    cloud_cover_925hPa: [80],
    geopotential_height_925hPa: [800],
    surface_pressure: [980],
  };

  it("3000 m RH 85% → BR in METAR body (no duplicate in TAF groupString)", () => {
    const hourly = { ...base, relative_humidity_2m: [85] };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 3000, false);
    expect(d.weather).toBe("BR");
    const t = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 3000, true);
    expect(t.weather).toBe("BR");
  });

  it("BECMG with BR never also carries NSW", () => {
    const hourly = {
      time: Array.from({ length: 8 }, (_, i) => `2026-11-17T${String(17 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(8).fill(12),
      dew_point_2m: Array(8).fill(10),
      relative_humidity_2m: Array(8).fill(85),
      pressure_msl: Array(8).fill(1014),
      wind_speed_10m: Array(8).fill(16),
      wind_direction_10m: Array(8).fill(170),
      wind_gusts_10m: Array(8).fill(30),
      visibility: [9999, 9999, 3000, 3000, 3000, 9999, 9999, 9999],
      precipitation: Array(8).fill(0),
      rain: Array(8).fill(0),
      showers: Array(8).fill(0),
      surface_pressure: Array(8).fill(980),
      cloud_cover_low: Array(8).fill(90),
      cloud_cover_925hPa: Array(8).fill(80),
      geopotential_height_925hPa: Array(8).fill(1200),
      cloud_cover_850hPa: Array(8).fill(20),
      geopotential_height_850hPa: Array(8).fill(1600),
    };
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T17:05:00Z",
      hourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    const segments = taf.raw.split("BECMG").slice(1);
    const withBr = segments.filter((s) => /\bBR\b/.test(s));
    expect(withBr.length).toBeGreaterThan(0);
    for (const seg of withBr) {
      expect(seg).not.toMatch(/\bNSW\b/);
    }
  });

  it("BECMG ending weather with no new wx carries NSW", () => {
    const hourly = {
      time: Array.from({ length: 5 }, (_, i) => `2026-11-17T${String(21 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(5).fill(17),
      dew_point_2m: Array(5).fill(14),
      relative_humidity_2m: Array(5).fill(70),
      pressure_msl: Array(5).fill(1014),
      wind_speed_10m: [15, 15, 8, 8, 8],
      wind_direction_10m: [280, 280, 360, 360, 360],
      wind_gusts_10m: [30, 30, 12, 12, 12],
      precipitation: [0.5, 0.5, 0, 0, 0],
      rain: Array(5).fill(0),
      showers: [0.5, 0.5, 0, 0, 0],
      surface_pressure: Array(5).fill(980),
      cloud_cover_low: [80, 80, 10, 10, 10],
      cloud_cover_925hPa: [80, 80, 10, 10, 10],
      geopotential_height_925hPa: Array(5).fill(1200),
      convective_cloud_base: [2200, 2200, -500, -500, -500],
      cloud_cover_850hPa: Array(5).fill(20),
      geopotential_height_850hPa: Array(5).fill(1600),
      cape: Array(5).fill(200),
    };
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "icon_seamless",
      runTime: "2026-11-17T20:43:00Z",
      hourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    expect(taf.raw).toMatch(/BECMG[^\n]*NSW/);
  });
});