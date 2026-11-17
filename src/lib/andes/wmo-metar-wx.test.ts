import { describe, expect, it } from "vitest";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import { generateModelMetar } from "@/lib/andes/wmo-metar";
import { cloudHeightHundredsFt, deriveMetarWxAndCloud } from "@/lib/andes/wmo-metar-wx";

const unresolvedLowBkn = {
  cloud_cover_low: [90],
  surface_pressure: [980],
  cloud_cover_925hPa: [10],
  geopotential_height_925hPa: [800],
  cloud_cover_850hPa: [20],
  geopotential_height_850hPa: [1600],
};

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
      ...unresolvedLowBkn,
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, ceil, 9999, false);
    expect(d.weather).not.toMatch(/DZ/);
    expect(d.clouds).not.toContain("///");
    expect(d.clouds).toMatch(/^BKN\d{3}$/);
  });

  it("20/09 unresolved low cloud → BKN045 + CLD EST", () => {
    const hourly = {
      time: ["t"],
      temperature_2m: [20],
      dew_point_2m: [9],
      relative_humidity_2m: [50],
      ...unresolvedLowBkn,
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, ceil, 9999, false);
    const lclFt = 125 * (20 - 9) * 3.280839895;
    expect(cloudHeightHundredsFt(lclFt)).toBe(45);
    expect(d.clouds).toBe("BKN045");
    expect(d.rmkExtra).toContain("CLD EST");
    expect(d.cldEstimated).toBe(true);
    expect(d.clouds).not.toContain("///");
  });

  it("spread > 15°C → no ceiling height, NSC, no ///", () => {
    const hourly = {
      time: ["t"],
      temperature_2m: [25],
      dew_point_2m: [8],
      relative_humidity_2m: [40],
      ...unresolvedLowBkn,
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, ceil, 9999, false);
    expect(d.clouds).toBe("NSC");
    expect(d.effectiveCeilFt).toBeNull();
    expect(d.clouds).not.toContain("///");
    expect(d.rmkExtra).not.toContain("CLD EST");
  });

  it("resolved pressure-level base is unchanged", () => {
    const hourly = {
      time: ["t"],
      temperature_2m: [14],
      dew_point_2m: [13],
      relative_humidity_2m: [95],
      cloud_cover_low: [90],
      precipitation: [0],
      visibility: [8000],
      surface_pressure: [980],
      cloud_cover_925hPa: [80],
      geopotential_height_925hPa: [800],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    expect(ceil.ceilingFtAgl).not.toBeNull();
    const d = deriveMetarWxAndCloud(hourly, 0, 649, ceil, 8000, false);
    expect(d.clouds).toMatch(/^(BKN|OVC)\d{3}$/);
    expect(d.cldEstimated).toBe(false);
    expect(d.rmkExtra).not.toContain("CLD EST");
  });

  it("never emits /// in METAR product", () => {
    const raw = generateModelMetar({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T12:00:00Z",
      validTime: "2026-11-17T18:00:00Z",
      hourly: {
        time: ["2026-11-17T18:00"],
        temperature_2m: [20],
        dew_point_2m: [9],
        pressure_msl: [1013],
        wind_speed_10m: [10],
        wind_direction_10m: [230],
        visibility: [9999],
        ...unresolvedLowBkn,
      },
      hourIndex: 0,
    });
    expect(raw.raw).not.toMatch(/\/\/\//);
  });

  it("no FG with 9999 visibility", () => {
    const hourly = { time: ["t"], visibility: [10000], temperature_2m: [15], dew_point_2m: [14] };
    const ceil = ceilingFromHourly(hourly, 0, 100);
    const d = deriveMetarWxAndCloud(hourly, 0, 100, ceil, 9999, false);
    expect(d.weather).not.toContain("FG");
  });
});