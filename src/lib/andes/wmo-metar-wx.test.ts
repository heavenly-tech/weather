import { describe, expect, it } from "vitest";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import { annex3NscEligible } from "@/lib/andes/wmo-metar-wx";
import { generateModelMetar } from "@/lib/andes/wmo-metar";
import { generateModelTaf } from "@/lib/andes/wmo-taf";
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
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9999, false);
    expect(d.weather).not.toMatch(/DZ/);
    expect(d.weather).toContain("-SHRA");
    expect(d.clouds).toMatch(/^BKN\d{3}$/);
  });

  it("orders precipitation before obscuration (-DZ BR)", () => {
    const hourly = {
      time: ["a", "b", "c"],
      temperature_2m: [11, 11, 11],
      dew_point_2m: [9, 9, 9],
      relative_humidity_2m: [85, 85, 85],
      precipitation: [0.2, 0.2, 0.2],
      rain: [0, 0, 0],
      showers: [0, 0, 0],
      cloud_cover_low: [80, 80, 80],
      surface_pressure: [980, 980, 980],
      cloud_cover_925hPa: [80, 80, 80],
      geopotential_height_925hPa: [900, 900, 900],
    };
    const ceil = ceilingFromHourly(hourly, 1, 649);
    const d = deriveMetarWxAndCloud(hourly, 1, 649, "SCTB", ceil, 3000, false);
    expect(d.weather).toBe("-DZ BR");
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
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9999, false);
    const lclFt = 125 * (20 - 9) * 3.280839895;
    expect(cloudHeightHundredsFt(lclFt)).toBe(45);
    expect(d.clouds).toBe("BKN045");
    expect(d.rmkExtra).toContain("CLD EST");
    expect(d.cldEstimated).toBe(true);
  });

  it("hot summer spread >15 → METAR BKN/// and TAF BKN050 + CLD EST", () => {
    const hourly = {
      time: Array.from({ length: 4 }, (_, i) => `2026-08-18T${String(12 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(4).fill(26),
      dew_point_2m: Array(4).fill(9),
      relative_humidity_2m: Array(4).fill(40),
      pressure_msl: Array(4).fill(1010),
      wind_speed_10m: Array(4).fill(10),
      wind_direction_10m: Array(4).fill(230),
      wind_gusts_10m: Array(4).fill(20),
      visibility: Array(4).fill(9999),
      precipitation: Array(4).fill(0),
      rain: Array(4).fill(0),
      showers: Array(4).fill(0),
      ...unresolvedLowBkn,
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const metarDerived = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9999, false);
    expect(metarDerived.clouds).toBe("BKN///");
    const tafDerived = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9999, true);
    expect(tafDerived.clouds).toBe("BKN050");
    expect(tafDerived.rmkExtra).toContain("CLD EST");

    const metar = generateModelMetar({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-08-18T12:00:00Z",
      validTime: "2026-08-18T12:00:00Z",
      hourly,
      hourIndex: 0,
    });
    expect(metar.raw).toMatch(/BKN\/\/\//);
    expect(metar.raw).toMatch(/RMK\b.*CLD BASE UNK/);
    expect(metarDerived.rmkExtra).toContain("CLD BASE UNK");
    expect((metar.raw.match(/\bRMK\b/g) ?? []).length).toBe(1);

    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-08-18T12:00:00Z",
      hourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    expect(taf.raw).toMatch(/BKN050/);
    expect(taf.raw).toMatch(/RMK\b.*CLD EST/);
  });

  it("NSC when low cover below BKN and no level below MSA ceiling", () => {
    const hourly = {
      time: ["t"],
      temperature_2m: [20],
      dew_point_2m: [8],
      relative_humidity_2m: [50],
      cloud_cover_low: [25],
      surface_pressure: [980],
      cloud_cover_925hPa: [10],
      geopotential_height_925hPa: [800],
    };
    expect(annex3NscEligible(hourly, 0, 649, "SCTB")).toBe(true);
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9999, false);
    expect(d.clouds).toBe("NSC");
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
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 8000, false);
    expect(d.clouds).toMatch(/^(BKN|OVC)\d{3}$/);
    expect(d.cldEstimated).toBe(false);
  });

  it("CAPE-only ICON base is FEW, not a ceiling", () => {
    const hourly = {
      time: ["t"],
      temperature_2m: [22],
      dew_point_2m: [8],
      relative_humidity_2m: [40],
      surface_pressure: [955],
      convective_cloud_base: [2000],
      cape: [250],
      showers: [0],
      rain: [0],
      precipitation: [0],
      cloud_cover_low: [8],
      cloud_cover_850hPa: [5],
      geopotential_height_850hPa: [2200],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9999, false);
    expect(d.clouds).toMatch(/^FEW\d{3}$/);
    expect(d.effectiveCeilFt).toBeNull();
  });

  it("drops SH in dry air when there is no cloud layer", () => {
    const hourly = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [28],
      dew_point_2m: [6],
      relative_humidity_2m: [30],
      precipitation: [0.4],
      showers: [0.4],
      rain: [0],
      visibility: [8000],
      cloud_cover_low: [5],
      surface_pressure: [980],
      cloud_cover_925hPa: [5],
      geopotential_height_925hPa: [2200],
      pressure_msl: [1013],
      wind_speed_10m: [12],
      wind_direction_10m: [230],
      wind_gusts_10m: [16],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 8000, false);
    expect(d.clouds).toBe("NSC");
    expect(d.weather).not.toMatch(/SH/);
    const metar = generateModelMetar({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T18:00:00Z",
      validTime: "2026-11-17T18:00:00Z",
      hourly,
      hourIndex: 0,
    });
    expectNoShowerWithClearSky(metar.raw);
    expect(metar.raw).not.toMatch(/SHRA/);
    const n = 6;
    const tafHourly = {
      time: Array.from({ length: n }, (_, i) => `2026-11-17T${String(16 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(n).fill(28),
      dew_point_2m: Array(n).fill(6),
      relative_humidity_2m: Array(n).fill(30),
      precipitation: [0, 0, 0.4, 0.4, 0, 0],
      showers: [0, 0, 0.4, 0.4, 0, 0],
      rain: Array(n).fill(0),
      visibility: Array(n).fill(8000),
      cloud_cover_low: Array(n).fill(5),
      surface_pressure: Array(n).fill(980),
      cloud_cover_925hPa: Array(n).fill(5),
      geopotential_height_925hPa: Array(n).fill(2200),
      pressure_msl: Array(n).fill(1013),
      wind_speed_10m: Array(n).fill(12),
      wind_direction_10m: Array(n).fill(230),
      wind_gusts_10m: Array(n).fill(16),
    };
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T16:00:00Z",
      hourly: tafHourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    expectNoShowerWithClearSky(taf.raw);
    expect(taf.raw).not.toMatch(/SHRA/);
  });

  it("keeps SH only with an estimated convective layer, never NSC or NCD", () => {
    const n = 6;
    const showers = Array(n).fill(0);
    showers[3] = 0.4;
    const hourly = {
      time: Array.from({ length: n }, (_, i) => `2026-11-17T${String(16 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(n).fill(18),
      dew_point_2m: Array(n).fill(10),
      relative_humidity_2m: Array(n).fill(60),
      precipitation: showers,
      showers,
      rain: Array(n).fill(0),
      visibility: Array(n).fill(9000),
      cloud_cover_low: Array(n).fill(5),
      surface_pressure: Array(n).fill(980),
      cloud_cover_925hPa: Array(n).fill(5),
      geopotential_height_925hPa: Array(n).fill(2200),
      pressure_msl: Array(n).fill(1013),
      wind_speed_10m: Array(n).fill(16),
      wind_direction_10m: Array(n).fill(180),
      wind_gusts_10m: Array(n).fill(18),
    };
    const ceil = ceilingFromHourly(hourly, 3, 649);
    const d = deriveMetarWxAndCloud(hourly, 3, 649, "SCTB", ceil, 9000, false);
    expect(d.weather).toMatch(/-SHRA/);
    expect(d.clouds).toMatch(/^(?:FEW|SCT|BKN)\d{3}$/);
    expect(d.rmkExtra).toContain("CLD EST");
    const metar = generateModelMetar({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T19:00:00Z",
      validTime: "2026-11-17T19:00:00Z",
      hourly,
      hourIndex: 3,
    });
    expectNoShowerWithClearSky(metar.raw);
    expect(metar.raw).toMatch(/SHRA/);
    expect(metar.raw).toMatch(/RMK\b.*CLD EST/);
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T16:00:00Z",
      hourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    expectNoShowerWithClearSky(taf.raw);
    expect(taf.raw).toMatch(/TEMPO\s+\d{4}\/\d{4}\s+[^\n]*-SHRA\s+[^\n]*(?:FEW|SCT|BKN)\d{3}/);
  });

  it("no FG with 9999 visibility", () => {
    const hourly = { time: ["t"], visibility: [10000], temperature_2m: [15], dew_point_2m: [14] };
    const ceil = ceilingFromHourly(hourly, 0, 100);
    const d = deriveMetarWxAndCloud(hourly, 0, 100, "SCVM", ceil, 9999, false);
    expect(d.weather).not.toContain("FG");
  });
});

function expectNoShowerWithClearSky(raw: string) {
  const body = raw.split(" RMK ")[0] ?? raw;
  const parts = body.split(/\b(?:BECMG|TEMPO|FM|PROB30|PROB40)\b/);
  for (const part of parts) {
    if (/\b[+-]?SH[A-Z]*/.test(part)) {
      expect(part).not.toMatch(/\b(?:NSC|NCD)\b/);
      expect(part).toMatch(/\b(?:FEW|SCT|BKN|OVC)(?:\d{3}|\/\/\/)/);
    }
  }
}