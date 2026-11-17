import { describe, expect, it } from "vitest";
import { formatModelWind, generateModelMetar } from "@/lib/andes/wmo-metar";
import { generateModelTaf } from "@/lib/andes/wmo-taf";
import { estimateVisibilityMeters, resolveVisibilityMeters } from "@/lib/andes/visibility-estimate";

describe("visibility estimate (RUC-style)", () => {
  it("high RH lowers estimated visibility below 10 km", () => {
    const vis = estimateVisibilityMeters(98, 0);
    expect(vis).toBeLessThan(5000);
    expect(vis).toBeGreaterThan(200);
  });

  it("ECMWF uses estimate — TAF never contains //// visibility", () => {
    const hourly = {
      time: ["2026-11-17T21:00", "2026-11-17T22:00", "2026-11-17T23:00"],
      relative_humidity_2m: [55, 55, 55],
      temperature_2m: [17, 17, 17],
      dew_point_2m: [12, 12, 12],
      pressure_msl: [1014, 1014, 1014],
      wind_speed_10m: [8, 8, 8],
      wind_direction_10m: [250, 250, 250],
      wind_gusts_10m: [20, 20, 20],
      precipitation: [0, 0, 0],
      rain: [0, 0, 0],
      showers: [0, 0, 0],
      surface_pressure: [980, 980, 980],
      cloud_cover_925hPa: [10, 10, 10],
      geopotential_height_925hPa: [1200, 1200, 1200],
      cloud_cover_850hPa: [5, 5, 5],
      geopotential_height_850hPa: [1600, 1600, 1600],
    };
    const metar = generateModelMetar({
      icao: "SCTB",
      elevM: 649,
      model: "ecmwf_ifs025",
      runTime: "2026-11-17T20:43:00Z",
      validTime: "2026-11-17T21:00:00Z",
      hourly,
      hourIndex: 0,
    });
    expect(metar.raw).toContain("VIS EST");
    expect(metar.raw).not.toMatch(/\s\/\/\/\//);
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "ecmwf_ifs025",
      runTime: "2026-11-17T20:43:00Z",
      hourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    expect(taf.raw).not.toContain("////");
    expect(taf.raw).toMatch(/\b9999\b|\b[0-9]{4}\b/);
  });

  it("GFS keeps observed visibility when present", () => {
    const hourly = { visibility: [3200], relative_humidity_2m: [99] };
    const r = resolveVisibilityMeters(hourly, 0, "gfs_seamless");
    expect(r.estimated).toBe(false);
    expect(r.visM).toBe(3200);
  });
});

describe("gust encoding (Annex 3)", () => {
  it("omits gust when <10 kt above mean", () => {
    expect(formatModelWind(170, 20, 28)).toBe("17011KT");
  });

  it("VRB with gust when mean <3 kt and gust >= mean+10 kt", () => {
    expect(formatModelWind(170, 4, 26)).toBe("VRB02G14KT");
  });
});

describe("TAF BECMG clears weather with NSW", () => {
  it("ends prior SHRA with NSW and numeric visibility", () => {
    const hourly = {
      time: Array.from({ length: 8 }, (_, i) => `2026-11-17T${String(21 + i).padStart(2, "0")}:00`),
      relative_humidity_2m: Array(8).fill(70),
      temperature_2m: Array(8).fill(17),
      dew_point_2m: Array(8).fill(14),
      pressure_msl: Array(8).fill(1014),
      wind_speed_10m: [15, 15, 8, 8, 8, 8, 8, 8],
      wind_direction_10m: [280, 280, 360, 360, 360, 360, 360, 360],
      wind_gusts_10m: [30, 30, 12, 12, 12, 12, 12, 12],
      precipitation: [0.5, 0.5, 0, 0, 0, 0, 0, 0],
      rain: [0, 0, 0, 0, 0, 0, 0, 0],
      showers: [0.5, 0.5, 0, 0, 0, 0, 0, 0],
      surface_pressure: Array(8).fill(980),
      cloud_cover_low: [80, 80, 10, 10, 10, 10, 10, 10],
      cloud_cover_925hPa: [80, 80, 10, 10, 10, 10, 10, 10],
      geopotential_height_925hPa: Array(8).fill(1200),
      convective_cloud_base: [2200, 2200, -500, -500, -500, -500, -500, -500],
      cloud_cover_850hPa: Array(8).fill(20),
      geopotential_height_850hPa: Array(8).fill(1600),
      cape: Array(8).fill(200),
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
    const becmg = taf.raw.match(/BECMG[^\n]*/)?.[0] ?? "";
    expect(becmg).toMatch(/NSW/);
    expect(becmg).not.toContain("////");
    expect(becmg).toMatch(/\d{4}/);
  });
});