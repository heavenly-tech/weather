import { describe, expect, it } from "vitest";
import { assertEstOnlyInTrailingRmk } from "@/lib/andes/product-rmk";
import { generateModelMetar } from "@/lib/andes/wmo-metar";
import { generateModelTaf } from "@/lib/andes/wmo-taf";

const unresolvedLowBkn = {
  cloud_cover_low: [90],
  surface_pressure: [980],
  cloud_cover_925hPa: [10],
  geopotential_height_925hPa: [800],
  cloud_cover_850hPa: [20],
  geopotential_height_850hPa: [1600],
};

describe("EST tokens only in trailing RMK", () => {
  it("METAR VIS/CLD EST stay after RMK", () => {
    const metar = generateModelMetar({
      icao: "SCTB",
      elevM: 649,
      model: "ecmwf_ifs025",
      runTime: "2026-11-17T20:00:00Z",
      validTime: "2026-11-17T21:00:00Z",
      hourly: {
        time: ["2026-11-17T21:00"],
        temperature_2m: [20],
        dew_point_2m: [9],
        pressure_msl: [1014],
        relative_humidity_2m: [55],
        wind_speed_10m: [8],
        wind_direction_10m: [250],
        wind_gusts_10m: [30],
        precipitation: [0],
        rain: [0],
        showers: [0],
        ...unresolvedLowBkn,
      },
      hourIndex: 0,
    });
    expect(() => assertEstOnlyInTrailingRmk(metar.raw)).not.toThrow();
    expect(metar.raw).toMatch(/RMK\b.*\b(CLD|VIS) EST/);
  });

  it("TAF VIS/CLD EST and BECMG body have no EST before RMK", () => {
    const hourly = {
      time: Array.from({ length: 6 }, (_, i) => `2026-11-17T${String(21 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(6).fill(17),
      dew_point_2m: Array(6).fill(14),
      pressure_msl: Array(6).fill(1014),
      relative_humidity_2m: Array(6).fill(70),
      wind_speed_10m: [15, 15, 8, 8, 8, 8],
      wind_direction_10m: [280, 280, 360, 360, 360, 360],
      wind_gusts_10m: [30, 30, 12, 12, 12, 12],
      precipitation: [0.5, 0.5, 0, 0, 0, 0],
      rain: Array(6).fill(0),
      showers: [0.5, 0.5, 0, 0, 0, 0],
      surface_pressure: Array(6).fill(980),
      cloud_cover_low: [80, 80, 10, 10, 10, 10],
      cloud_cover_925hPa: [80, 80, 10, 10, 10, 10],
      geopotential_height_925hPa: Array(6).fill(1200),
      convective_cloud_base: Array(6).fill(2200),
      cloud_cover_850hPa: Array(6).fill(20),
      geopotential_height_850hPa: Array(6).fill(1600),
      cape: Array(6).fill(200),
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
    expect(() => assertEstOnlyInTrailingRmk(taf.raw)).not.toThrow();
    const body = taf.raw.split(" RMK ")[0] ?? "";
    expect(body).not.toMatch(/\bEST\b/);
  });
});