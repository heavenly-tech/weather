import { describe, expect, it } from "vitest";
import { annex3NscCeilingFtAgl } from "@/lib/andes/airfield-msa";
import { ceilingFromHourly } from "@/lib/andes/ceiling";
import { annex3NscEligible, hasSignificantCloudBelowNscCeiling } from "@/lib/andes/wmo-metar-wx";
import { generateModelMetar } from "@/lib/andes/wmo-metar";
import { generateModelTaf } from "@/lib/andes/wmo-taf";
import { cloudHeightHundredsFt, deriveMetarWxAndCloud } from "@/lib/andes/wmo-metar-wx";
import { flightCategoryFromWx } from "@/lib/visibility";

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

  it("RA and DZ never share a group with NSC or NCD", () => {
    const bare = {
      cloud_cover_low: [5],
      cloud_cover_mid: [10],
      cloud_cover: [20],
      surface_pressure: [980],
      cloud_cover_925hPa: [5],
      geopotential_height_925hPa: [2200],
      cloud_cover_850hPa: [5],
      geopotential_height_850hPa: [1600],
    };
    const hourly = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [12],
      dew_point_2m: [10],
      relative_humidity_2m: [85],
      precipitation: [0.4],
      rain: [0.4],
      showers: [0],
      visibility: [8000],
      pressure_msl: [1013],
      wind_speed_10m: [12],
      wind_direction_10m: [200],
      wind_gusts_10m: [14],
      ...bare,
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const dropped = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 8000, false);
    expect(dropped.clouds).toBe("NSC");
    expect(dropped.weather).not.toMatch(/(?:^|\s)[+-]?(?:RA|DZ)(?:\s|$)/);
    const metar = generateModelMetar({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T18:00:00Z",
      validTime: "2026-11-17T18:00:00Z",
      hourly,
      hourIndex: 0,
    });
    expectNoRaDzWithClearSky(metar.raw);

    const n = 6;
    const tafHourly = {
      time: Array.from({ length: n }, (_, i) => `2026-11-17T${String(16 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(n).fill(12),
      dew_point_2m: Array(n).fill(10),
      relative_humidity_2m: Array(n).fill(85),
      precipitation: [0, 0, 0.4, 0.4, 0, 0],
      rain: [0, 0, 0.4, 0.4, 0, 0],
      showers: Array(n).fill(0),
      visibility: Array(n).fill(8000),
      pressure_msl: Array(n).fill(1013),
      wind_speed_10m: Array(n).fill(12),
      wind_direction_10m: Array(n).fill(200),
      wind_gusts_10m: Array(n).fill(14),
      cloud_cover_low: Array(n).fill(5),
      cloud_cover_mid: Array(n).fill(10),
      cloud_cover: Array(n).fill(20),
      surface_pressure: Array(n).fill(980),
      cloud_cover_925hPa: Array(n).fill(5),
      geopotential_height_925hPa: Array(n).fill(2200),
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
    expectNoRaDzWithClearSky(taf.raw);
    expect(taf.raw).not.toMatch(/(?:^|\s)[+-]?(?:RA|DZ)\b/);
  });

  it("writes estimated BKN at 700 hPa when mid cloud backs rain", () => {
    const gh = 3100;
    const elev = 649;
    const agl = (gh - elev) * 3.280839895;
    const hourly = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [12],
      dew_point_2m: [10],
      relative_humidity_2m: [85],
      precipitation: [0.4],
      rain: [0.4],
      showers: [0],
      visibility: [9000],
      cloud_cover_low: [10],
      cloud_cover_mid: [60],
      cloud_cover: [40],
      surface_pressure: [980],
      cloud_cover_925hPa: [10],
      geopotential_height_925hPa: [2200],
      geopotential_height_700hPa: [gh],
      pressure_msl: [1013],
      wind_speed_10m: [12],
      wind_direction_10m: [200],
    };
    const ceil = ceilingFromHourly(hourly, 0, elev);
    const d = deriveMetarWxAndCloud(hourly, 0, elev, "SCTB", ceil, 9000, false);
    expect(d.weather).toMatch(/-RA/);
    expect(d.clouds).toBe(`BKN${String(cloudHeightHundredsFt(agl)).padStart(3, "0")}`);
    expect(d.effectiveCeilFt).toBeCloseTo(agl, 4);
    expect(d.rmkExtra).toContain("CLD EST");
    expect(d.clouds).not.toMatch(/NSC|NCD/);
  });

  it("ECMWF light rain with 2% low cloud does not use a low LCL", () => {
    const gh = 3100;
    const elev = 649;
    const agl700 = (gh - elev) * 3.280839895;
    const hourly = {
      time: ["2026-11-17T06:00"],
      temperature_2m: [9],
      dew_point_2m: [8.6],
      relative_humidity_2m: [96],
      precipitation: [0.3],
      rain: [0.3],
      showers: [0],
      visibility: [8000],
      cloud_cover_low: [2],
      cloud_cover_mid: [8],
      cloud_cover: [12],
      surface_pressure: [980],
      geopotential_height_700hPa: [gh],
      pressure_msl: [1014],
      wind_speed_10m: [4],
      wind_direction_10m: [160],
    };
    const lclFt = 125 * (9 - 8.6) * 3.280839895;
    expect(lclFt).toBeLessThan(1500);
    const ceil = ceilingFromHourly(hourly, 0, elev);
    const d = deriveMetarWxAndCloud(hourly, 0, elev, "SCTB", ceil, 8000, false, false, "ecmwf_ifs025");
    expect(d.clouds).toBe(`FEW${String(cloudHeightHundredsFt(agl700)).padStart(3, "0")}`);
    expect(d.clouds).not.toMatch(/^(?:FEW|SCT|BKN|OVC)00\d$/);
    const hundreds = Number(d.clouds.slice(3));
    expect(hundreds * 100).toBeGreaterThanOrEqual(1500);
    expect(d.weather).toMatch(/SHRA/);
    expect(d.weather).not.toMatch(/\bHZ\b/);
  });

  it("ECMWF mid cloud writes BKN at 700 hPa, not the LCL", () => {
    const gh = 3100;
    const elev = 649;
    const agl700 = (gh - elev) * 3.280839895;
    const hourly = {
      time: ["2026-11-17T06:00"],
      temperature_2m: [9],
      dew_point_2m: [8.6],
      relative_humidity_2m: [96],
      precipitation: [0.3],
      rain: [0.3],
      showers: [0],
      visibility: [9000],
      cloud_cover_low: [2],
      cloud_cover_mid: [55],
      cloud_cover: [20],
      surface_pressure: [980],
      geopotential_height_700hPa: [gh],
    };
    const ceil = ceilingFromHourly(hourly, 0, elev);
    const d = deriveMetarWxAndCloud(hourly, 0, elev, "SCTB", ceil, 9000, false, false, "ecmwf_ifs025");
    expect(d.clouds).toBe(`BKN${String(cloudHeightHundredsFt(agl700)).padStart(3, "0")}`);
    expect(d.effectiveCeilFt).toBeCloseTo(agl700, 4);
    expect(d.rmkExtra).toContain("CLD EST");
    expect(d.weather).toMatch(/(?:^|\s)-RA(?:\s|$)/);
    expect(d.weather).not.toMatch(/SHRA/);
  });

  it("ECMWF ignores total cloud when choosing the estimated layer", () => {
    const gh = 3100;
    const elev = 649;
    const agl700 = (gh - elev) * 3.280839895;
    const hourly = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [16],
      dew_point_2m: [8],
      relative_humidity_2m: [55],
      precipitation: [0.4],
      rain: [0.4],
      showers: [0],
      visibility: [9000],
      cloud_cover_low: [4],
      cloud_cover_mid: [6],
      cloud_cover: [90],
      surface_pressure: [980],
      geopotential_height_700hPa: [gh],
      cape: [0],
    };
    const ceil = ceilingFromHourly(hourly, 0, elev);
    const d = deriveMetarWxAndCloud(hourly, 0, elev, "SCTB", ceil, 9000, false, false, "ecmwf_ifs025");
    expect(d.clouds).toBe(`FEW${String(cloudHeightHundredsFt(agl700)).padStart(3, "0")}`);
    expect(d.clouds).not.toMatch(/^BKN/);
    expect(d.weather).toMatch(/SHRA/);
  });

  it("drops ECMWF trace rain below 0.2 mm/h when total cloud is under 25%", () => {
    const hourly = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [16],
      dew_point_2m: [8],
      relative_humidity_2m: [55],
      precipitation: [0.15],
      rain: [0.15],
      showers: [0],
      visibility: [9000],
      cloud_cover_low: [4],
      cloud_cover_mid: [6],
      cloud_cover: [12],
      surface_pressure: [980],
      geopotential_height_700hPa: [3100],
      cape: [0],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9000, false, false, "ecmwf_ifs025");
    expect(d.weather).not.toMatch(/SHRA|(?:^|\s)[+-]?RA(?:\s|$)/);
    expect(d.clouds).not.toMatch(/^(?:FEW|SCT|BKN|OVC)/);
    expect(d.cldEstimated).toBe(false);
  });

  it("encodes an ECMWF mid deck as -RA and keeps SH when the cloud is convective or low", () => {
    const gh = 3100;
    const elev = 649;
    const agl700 = (gh - elev) * 3.280839895;
    const deck = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [12],
      dew_point_2m: [8],
      relative_humidity_2m: [70],
      precipitation: [0.4],
      rain: [0.4],
      showers: [0],
      visibility: [9000],
      cloud_cover_low: [8],
      cloud_cover_mid: [60],
      cloud_cover: [40],
      surface_pressure: [980],
      geopotential_height_700hPa: [gh],
      cape: [0],
    };
    const ceil = ceilingFromHourly(deck, 0, elev);
    const rain = deriveMetarWxAndCloud(deck, 0, elev, "SCTB", ceil, 9000, false, false, "ecmwf_ifs025");
    expect(rain.clouds).toBe(`BKN${String(cloudHeightHundredsFt(agl700)).padStart(3, "0")}`);
    expect(rain.rmkExtra).toContain("CLD EST");
    expect(rain.weather).toMatch(/(?:^|\s)-RA(?:\s|$)/);
    expect(rain.weather).not.toMatch(/SHRA/);
    const convective = deriveMetarWxAndCloud(
      { ...deck, cape: [250] },
      0,
      elev,
      "SCTB",
      ceil,
      9000,
      false,
      false,
      "ecmwf_ifs025"
    );
    expect(convective.weather).toMatch(/SHRA/);
    expect(convective.weather).not.toMatch(/(?:^|\s)[+-]?RA(?:\s|$)/);
    const low = {
      ...deck,
      cloud_cover_low: [80],
      cloud_cover_925hPa: [80],
      geopotential_height_925hPa: [900],
      cape: [0],
    };
    const lowCeil = ceilingFromHourly(low, 0, elev);
    const showers = deriveMetarWxAndCloud(low, 0, elev, "SCTB", lowCeil, 9000, false, false, "ecmwf_ifs025");
    expect(showers.weather).toMatch(/SHRA/);
    expect(showers.weather).not.toMatch(/(?:^|\s)[+-]?RA(?:\s|$)/);
  });

  it("drops HZ when precipitation explains the visibility and keeps BR", () => {
    const layer = {
      cloud_cover_low: [70],
      surface_pressure: [980],
      cloud_cover_925hPa: [70],
      geopotential_height_925hPa: [1140],
    };
    const hazy = {
      time: ["t"],
      temperature_2m: [16],
      dew_point_2m: [8],
      relative_humidity_2m: [55],
      precipitation: [0.4],
      showers: [0.4],
      rain: [0],
      visibility: [5000],
      ...layer,
    };
    const ceil = ceilingFromHourly(hazy, 0, 649);
    const dryHaze = deriveMetarWxAndCloud(hazy, 0, 649, "SCTB", ceil, 5000, false);
    expect(dryHaze.weather).toMatch(/SHRA/);
    expect(dryHaze.weather).not.toMatch(/\bHZ\b/);
    expect(dryHaze.clouds).toMatch(/^BKN\d{3}$/);
    const moist = {
      ...hazy,
      relative_humidity_2m: [85],
      dew_point_2m: [14],
    };
    const withBr = deriveMetarWxAndCloud(moist, 0, 649, "SCTB", ceil, 5000, false);
    expect(withBr.weather).toMatch(/SHRA BR/);
    expect(withBr.weather).not.toMatch(/\bHZ\b/);
  });

  it("treats ECMWF rain as showers", () => {
    const hourly = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [14],
      dew_point_2m: [12],
      relative_humidity_2m: [80],
      precipitation: [0.8],
      rain: [0.8],
      showers: [0],
      visibility: [9000],
      cloud_cover_low: [80],
      surface_pressure: [980],
      cloud_cover_925hPa: [80],
      geopotential_height_925hPa: [900],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9000, false, false, "ecmwf_ifs025");
    expect(d.weather).toMatch(/SHRA/);
    expect(d.weather).not.toMatch(/(?:^|\s)[+-]?RA(?:\s|$)/);
    expect(d.clouds).toMatch(/^(?:FEW|SCT|BKN|OVC)/);
  });

  it("SCTB NSC includes 600 and 500 hPa when they are below the MSA ceiling", () => {
    const threshold = annex3NscCeilingFtAgl("SCTB", 649);
    const agl600 = (4200 - 649) * 3.280839895;
    expect(agl600).toBeGreaterThan(5000);
    expect(agl600).toBeLessThan(threshold);
    const low = {
      time: ["t"],
      surface_pressure: [900],
      cloud_cover_600hPa: [80],
      geopotential_height_600hPa: [4200],
    };
    expect(hasSignificantCloudBelowNscCeiling(low, 0, 649, "SCTB")).toBe(true);
    expect(annex3NscEligible(low, 0, 649, "SCTB")).toBe(false);
    const above = 649 + (threshold + 800) / 3.280839895;
    expect(
      hasSignificantCloudBelowNscCeiling(
        { ...low, geopotential_height_600hPa: [above] },
        0,
        649,
        "SCTB"
      )
    ).toBe(false);
    const at500 = {
      time: ["t"],
      surface_pressure: [900],
      cloud_cover_500hPa: [70],
      geopotential_height_500hPa: [5600],
    };
    const agl500 = (5600 - 649) * 3.280839895;
    expect(agl500).toBeLessThan(threshold);
    expect(hasSignificantCloudBelowNscCeiling(at500, 0, 649, "SCTB")).toBe(true);
  });

  it("keeps precip on an obscured sky, precipitation before FG", () => {
    const hourly = {
      time: ["2026-11-17T12:00"],
      temperature_2m: [8],
      dew_point_2m: [7.6],
      relative_humidity_2m: [97],
      precipitation: [0.6],
      rain: [0],
      showers: [0],
      visibility: [400],
      cloud_cover_low: [90],
      surface_pressure: [980],
      cloud_cover_925hPa: [40],
      geopotential_height_925hPa: [900],
      pressure_msl: [1014],
      wind_speed_10m: [6],
      wind_direction_10m: [180],
      wind_gusts_10m: [8],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    expect(ceil.obscured).toBe(true);
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 400, false, false, "gfs_seamless");
    expect(d.clouds).toBe("VV000");
    expect(d.weather).toMatch(/^(-RA|-DZ) FG$/);
    const metar = generateModelMetar({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T12:00:00Z",
      validTime: "2026-11-17T12:00:00Z",
      hourly,
      hourIndex: 0,
    });
    expect(metar.raw).toMatch(/\b0400\s+(-RA|-DZ)\s+FG\s+VV000\b/);
  });

  it("heavy-shower BKN sets the reported ceiling and flight category", () => {
    const agl = 250 * 3.280839895;
    const hourly = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [14],
      dew_point_2m: [12],
      relative_humidity_2m: [80],
      precipitation: [3],
      showers: [3],
      rain: [0],
      visibility: [9999],
      cloud_cover_low: [8],
      surface_pressure: [980],
      cloud_cover_925hPa: [5],
      geopotential_height_925hPa: [2200],
    };
    const ceil = ceilingFromHourly(hourly, 0, 649);
    expect(ceil.ceilingFtAgl).toBeNull();
    const d = deriveMetarWxAndCloud(hourly, 0, 649, "SCTB", ceil, 9999, false);
    expect(d.clouds).toBe(`BKN${String(cloudHeightHundredsFt(agl)).padStart(3, "0")}`);
    expect(d.effectiveCeilFt).toBeCloseTo(agl, 4);
    expect(d.flightCategory).toBe(flightCategoryFromWx(9999, agl));
    expect(d.flightCategory).toBe("IFR");
    expect(d.weather).toMatch(/SHRA/);
  });

  it("no FG with 9999 visibility", () => {
    const hourly = { time: ["t"], visibility: [10000], temperature_2m: [15], dew_point_2m: [14] };
    const ceil = ceilingFromHourly(hourly, 0, 100);
    const d = deriveMetarWxAndCloud(hourly, 0, 100, "SCVM", ceil, 9999, false);
    expect(d.weather).not.toContain("FG");
  });

  it("ECMWF falls back to 600 hPa when the 700 hPa height is missing", () => {
    // EXAMPLE hour. No 700 hPa geopotential, so the estimated base is 600 hPa.
    const gh600 = 4200;
    const elev = 649;
    const agl600 = (gh600 - elev) * 3.280839895;
    const hundreds = String(cloudHeightHundredsFt(agl600)).padStart(3, "0");
    const light = {
      time: ["2026-11-17T06:00"],
      temperature_2m: [9],
      dew_point_2m: [8.6],
      relative_humidity_2m: [96],
      precipitation: [0.3],
      rain: [0.3],
      showers: [0],
      visibility: [8000],
      cloud_cover_low: [2],
      cloud_cover_mid: [8],
      cloud_cover: [12],
      surface_pressure: [980],
      geopotential_height_600hPa: [gh600],
    };
    const lightCeil = ceilingFromHourly(light, 0, elev);
    const few = deriveMetarWxAndCloud(light, 0, elev, "SCTB", lightCeil, 8000, false, false, "ecmwf_ifs025");
    expect(few.clouds).toBe(`FEW${hundreds}`);
    expect(few.weather).toMatch(/SHRA/);

    const deck = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [12],
      dew_point_2m: [8],
      relative_humidity_2m: [70],
      precipitation: [0.4],
      rain: [0.4],
      showers: [0],
      visibility: [9000],
      cloud_cover_low: [8],
      cloud_cover_mid: [60],
      cloud_cover: [40],
      surface_pressure: [980],
      geopotential_height_700hPa: [null],
      geopotential_height_600hPa: [gh600],
      cape: [0],
    };
    const deckCeil = ceilingFromHourly(deck, 0, elev);
    const rain = deriveMetarWxAndCloud(deck, 0, elev, "SCTB", deckCeil, 9000, false, false, "ecmwf_ifs025");
    expect(rain.clouds).toBe(`BKN${hundreds}`);
    expect(rain.effectiveCeilFt).toBeCloseTo(agl600, 4);
    expect(rain.rmkExtra).toContain("CLD EST");
    expect(rain.weather).toMatch(/(?:^|\s)-RA(?:\s|$)/);
    expect(rain.weather).not.toMatch(/SHRA/);
  });

  it("ECMWF with no mid-cloud series stays on the low-cloud decision", () => {
    // EXAMPLE hour. Absent and null cloud_cover_mid both mean no mid deck.
    const gh = 3100;
    const elev = 649;
    const agl700 = (gh - elev) * 3.280839895;
    const few = `FEW${String(cloudHeightHundredsFt(agl700)).padStart(3, "0")}`;
    const shared = {
      time: ["2026-11-17T18:00"],
      temperature_2m: [16],
      dew_point_2m: [8],
      relative_humidity_2m: [55],
      precipitation: [0.4],
      rain: [0.4],
      showers: [0],
      visibility: [9000],
      cloud_cover_low: [8],
      cloud_cover: [40],
      surface_pressure: [980],
      geopotential_height_700hPa: [gh],
      cape: [0],
    };
    const encode = (hourly: Record<string, Array<number | null> | string[]>) => {
      const ceil = ceilingFromHourly(hourly, 0, elev);
      return deriveMetarWxAndCloud(hourly, 0, elev, "SCTB", ceil, 9000, false, false, "ecmwf_ifs025");
    };
    for (const hourly of [shared, { ...shared, cloud_cover_mid: [null] }]) {
      const d = encode(hourly);
      expect(d.clouds).toBe(few);
      expect(d.weather).toMatch(/SHRA/);
      expect(d.weather).not.toMatch(/(?:^|\s)-RA(?:\s|$)/);
    }
    const deck = encode({ ...shared, cloud_cover_mid: [60] });
    expect(deck.clouds).toMatch(/^BKN/);
    expect(deck.weather).toMatch(/(?:^|\s)-RA(?:\s|$)/);
    expect(deck.weather).not.toMatch(/SHRA/);
  });
});

function expectNoRaDzWithClearSky(raw: string) {
  const body = raw.split(" RMK ")[0] ?? raw;
  const parts = body.split(/\b(?:BECMG|TEMPO|FM|PROB30|PROB40)\b/);
  for (const part of parts) {
    if (/(?:^|\s)[+-]?(?:RA|DZ)\b/.test(part) && !/\bSHRA\b/.test(part)) {
      expect(part).not.toMatch(/\b(?:NSC|NCD)\b/);
    }
    if (/\b(?:NSC|NCD)\b/.test(part)) {
      expect(part).not.toMatch(/(?:^|\s)[+-]?(?:RA|DZ)\b/);
    }
  }
}

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