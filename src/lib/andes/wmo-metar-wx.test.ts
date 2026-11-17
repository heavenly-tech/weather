import { describe, expect, it } from "vitest";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import { deriveMetarWxAndCloud } from "@/lib/andes/wmo-metar-wx";

describe("deriveMetarWxAndCloud", () => {
  it("no DZ when spread > 5°C with light precip", () => {
    const hourly = {
      time: ["t"],
      temperature_2m: [21],
      dew_point_2m: [9],
      relative_humidity_2m: [46],
      precipitation: [0.2],
      showers: [0.2],
      rain: [0],
      visibility: [9999],
      cloud_cover_low: [100],
      surface_pressure: [980],
      cloud_cover_925hPa: [0],
      geopotential_height_925hPa: [1500],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, ceil, 9999, false);
    expect(d.weather).not.toMatch(/DZ/);
    expect(d.clouds).toMatch(/^(NSC|BKN\/\/\/)$/);
  });

  it("stratus unresolved → LCL estimate, not NSC", () => {
    const hourly = {
      time: ["t"],
      temperature_2m: [14],
      dew_point_2m: [13],
      relative_humidity_2m: [95],
      cloud_cover_low: [90],
      precipitation: [0],
      visibility: [8000],
      surface_pressure: [980],
      cloud_cover_925hPa: [13],
      geopotential_height_925hPa: [800],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    expect(ceil.lowCloudUnresolved).toBe(true);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, ceil, 8000, false);
    expect(d.clouds).toMatch(/^BKN\d{3}$/);
    expect(d.rmkExtra).toContain("CB EST LCL");
    expect(d.clouds).not.toBe("NSC");
  });

  it("never FEW000 / SCT000", () => {
    const hourly = {
      time: ["t"],
      temperature_2m: [20],
      dew_point_2m: [10],
      cloud_cover_low: [25],
      surface_pressure: [990],
    };
    const ceil = ceilingFromHourly(hourly, 0, 100);
    const d = deriveMetarWxAndCloud(hourly, 0, 100, ceil, 9999, false);
    expect(d.clouds).not.toMatch(/000$/);
  });

  it("no FG with 9999 visibility", () => {
    const hourly = { time: ["t"], visibility: [10000], temperature_2m: [15], dew_point_2m: [14] };
    const ceil = ceilingFromHourly(hourly, 0, 100);
    const d = deriveMetarWxAndCloud(hourly, 0, 100, ceil, 9999, false);
    expect(d.weather).not.toContain("FG");
  });
});