import { describe, expect, it } from "vitest";
import { assertModelTafFormat } from "@/lib/andes/taf-format";
import { generateModelTaf, tafDdhh, tafValidityEnd } from "@/lib/andes/wmo-taf";
import { STAMP } from "@/lib/andes/wmo-metar";

function hours(n: number, start = "2026-11-17T12:00") {
  const time: string[] = [];
  const hourly: Record<string, number[]> = {
    visibility: [],
    wind_speed_10m: [],
    wind_direction_10m: [],
    precipitation: [],
    surface_pressure: [],
    cloud_cover_925hPa: [],
    geopotential_height_925hPa: [],
    cloud_cover_850hPa: [],
    geopotential_height_850hPa: [],
  };
  for (let i = 0; i < n; i++) {
    const d = new Date(`${start}Z`);
    d.setUTCHours(d.getUTCHours() + i);
    time.push(d.toISOString().slice(0, 16));
    const low = i < 3 ? 70 : i < 8 ? 70 : 5;
    const cover925 = i < 3 ? 80 : i < 8 ? 80 : 10;
    hourly.visibility!.push(i < 3 ? 6000 : 9999);
    hourly.wind_speed_10m!.push(16);
    hourly.wind_direction_10m!.push(170 + (i % 2) * 10);
    hourly.cloud_cover_925hPa!.push(cover925);
    hourly.geopotential_height_925hPa!.push(1200);
    hourly.cloud_cover_850hPa!.push(low);
    hourly.geopotential_height_850hPa!.push(1600);
    hourly.surface_pressure!.push(980);
    hourly.precipitation!.push(0);
    if (!hourly.relative_humidity_2m) hourly.relative_humidity_2m = [];
    hourly.relative_humidity_2m!.push(55);
    if (!hourly.rain) hourly.rain = [];
    hourly.rain!.push(0);
    if (!hourly.showers) hourly.showers = [];
    hourly.showers!.push(0);
  }
  return { time, ...hourly };
}

describe("generateModelTaf", () => {
  it("stratus clearing yields few BECMG groups and passes validator", () => {
    const hourly = hours(30, "2026-11-17T11:00");
    const result = generateModelTaf({
      icao: "SCEL",
      elevM: 474,
      model: "gfs_seamless",
      runTime: "2026-11-17T17:20:27Z",
      hourly: hourly as Record<string, Array<number | null> | string[]>,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.raw.startsWith(STAMP)).toBe(true);
    const becmg = (result.raw.match(/\bBECMG\b/g) ?? []).length;
    expect(becmg).toBeLessThanOrEqual(3);
    const check = assertModelTafFormat(result.raw);
    expect(check.ok, check.ok ? "" : check.reasons.join("; ")).toBe(true);
  });

  it("validity starts at next whole hour and uses 24 for midnight end", () => {
    const hourly = hours(30, "2026-11-17T16:00");
    const result = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T17:20:27Z",
      hourly: hourly as Record<string, Array<number | null> | string[]>,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.raw).toMatch(/1718\/1818/);
  });

  it("calm wind is 00000KT in TAF", () => {
    const hourly = hours(24) as Record<string, number[] | string[]> & { time: string[] };
    for (let i = 0; i < 24; i++) {
      (hourly.wind_speed_10m as number[])[i] = 0;
      (hourly.wind_direction_10m as number[])[i] = 180;
    }
    const result = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T22:00:00Z",
      hourly: hourly as unknown as Record<string, Array<number | null> | string[]>,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.raw).toContain("00000KT");
  });

  it("wind noise alone does not emit BECMG every hour", () => {
    const hourly = hours(24) as unknown as Record<string, number[]>;
    for (let i = 0; i < 24; i++) {
      hourly.wind_speed_10m![i] = 16;
      hourly.wind_direction_10m![i] = 170 + (i % 3) * 15;
      hourly.visibility![i] = 9999;
      hourly.cloud_cover_925hPa![i] = 5;
    }
    const result = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T10:00:00Z",
      hourly: hourly as Record<string, Array<number | null> | string[]>,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect((result.raw.match(/\bBECMG\b/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("does not emit a BECMG every hour when BR and HZ alternate", () => {
    const n = 10;
    const hourly = {
      time: Array.from({ length: n }, (_, i) => `2026-11-17T${String(16 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(n).fill(12),
      dew_point_2m: Array(n).fill(8),
      relative_humidity_2m: Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 85 : 60)),
      pressure_msl: Array(n).fill(1014),
      wind_speed_10m: Array(n).fill(16),
      wind_direction_10m: Array(n).fill(180),
      wind_gusts_10m: Array(n).fill(20),
      visibility: Array(n).fill(4000),
      precipitation: Array(n).fill(0),
      rain: Array(n).fill(0),
      showers: Array(n).fill(0),
      surface_pressure: Array(n).fill(980),
      cloud_cover_low: Array(n).fill(80),
      cloud_cover_925hPa: Array(n).fill(80),
      geopotential_height_925hPa: Array(n).fill(1200),
      cloud_cover_850hPa: Array(n).fill(20),
      geopotential_height_850hPa: Array(n).fill(1600),
    };
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T16:10:00Z",
      hourly: hourly as Record<string, Array<number | null> | string[]>,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    expect((taf.raw.match(/\bBECMG\b/g) ?? []).length).toBe(0);
    expect(taf.raw).not.toMatch(/NSW/);
  });

  it("keeps a one-hour shower as TEMPO -SHRA and ignores a one-hour -RA", () => {
    const n = 8;
    const showers = Array(n).fill(0);
    const rain = Array(n).fill(0);
    const precip = Array(n).fill(0);
    showers[4] = 0.8;
    precip[4] = 0.8;
    rain[6] = 0.3;
    precip[6] = 0.3;
    const hourly = {
      time: Array.from({ length: n }, (_, i) => `2026-11-17T${String(16 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(n).fill(12),
      dew_point_2m: Array(n).fill(10),
      relative_humidity_2m: Array(n).fill(70),
      pressure_msl: Array(n).fill(1014),
      wind_speed_10m: Array(n).fill(16),
      wind_direction_10m: Array(n).fill(180),
      wind_gusts_10m: Array(n).fill(20),
      visibility: Array(n).fill(9000),
      precipitation: precip,
      rain,
      showers,
      surface_pressure: Array(n).fill(980),
      cloud_cover_low: Array(n).fill(30),
      cloud_cover_925hPa: Array(n).fill(20),
      geopotential_height_925hPa: Array(n).fill(1600),
      cloud_cover_850hPa: Array(n).fill(10),
      geopotential_height_850hPa: Array(n).fill(2200),
    };
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T16:10:00Z",
      hourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    expect(taf.raw).toMatch(/TEMPO\s+\d{4}\/\d{4}\s+[^\n]*-SHRA/);
    expect(taf.raw).not.toMatch(/-RA/);
    const showerTempo = taf.raw.split("TEMPO").slice(1).find((part) => part.includes("SHRA")) ?? "";
    expect(showerTempo).not.toMatch(/\bNSW\b/);
  });

  it("puts CLD EST on the TAF RMK when only a change group has an estimated base", () => {
    const n = 8;
    const low = Array(n).fill(10);
    low[4] = 90;
    low[5] = 90;
    low[6] = 90;
    const hourly = {
      time: Array.from({ length: n }, (_, i) => `2026-11-17T${String(16 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(n).fill(26),
      dew_point_2m: Array(n).fill(9),
      relative_humidity_2m: Array(n).fill(35),
      pressure_msl: Array(n).fill(1014),
      wind_speed_10m: [16, 16, 16, 16, 40, 40, 40, 16],
      wind_direction_10m: Array(n).fill(180),
      wind_gusts_10m: Array(n).fill(20),
      visibility: Array(n).fill(9999),
      precipitation: Array(n).fill(0),
      rain: Array(n).fill(0),
      showers: Array(n).fill(0),
      surface_pressure: Array(n).fill(980),
      cloud_cover_low: low,
      cloud_cover_925hPa: Array(n).fill(10),
      geopotential_height_925hPa: Array(n).fill(800),
      cloud_cover_850hPa: Array(n).fill(10),
      geopotential_height_850hPa: Array(n).fill(1600),
    };
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T16:10:00Z",
      hourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    const [body, rmk] = taf.raw.split(" RMK ");
    expect(body).toMatch(/BECMG[^\n]*BKN050/);
    expect(body).not.toMatch(/\bEST\b/);
    expect(rmk).toMatch(/CLD EST/);
  });

  it("a 13 h BR run is a BECMG of 2 h, and a later change is its own group", () => {
    const n = 20;
    const br = (i: number) => i >= 2 && i <= 14;
    const hourly = {
      time: Array.from({ length: n }, (_, i) => {
        const d = new Date("2026-11-17T12:00:00Z");
        d.setUTCHours(d.getUTCHours() + i);
        return d.toISOString().slice(0, 16);
      }),
      temperature_2m: Array(n).fill(12),
      dew_point_2m: Array.from({ length: n }, (_, i) => (br(i) ? 10 : 1)),
      relative_humidity_2m: Array.from({ length: n }, (_, i) => (br(i) ? 85 : 40)),
      pressure_msl: Array(n).fill(1014),
      wind_speed_10m: Array(n).fill(16),
      wind_direction_10m: Array(n).fill(180),
      wind_gusts_10m: Array(n).fill(18),
      visibility: Array.from({ length: n }, (_, i) => (br(i) ? 5000 : 9999)),
      precipitation: Array(n).fill(0),
      rain: Array(n).fill(0),
      showers: Array(n).fill(0),
      surface_pressure: Array(n).fill(980),
      cloud_cover_low: Array(n).fill(10),
      cloud_cover_925hPa: Array(n).fill(10),
      geopotential_height_925hPa: Array(n).fill(1600),
    };
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T12:00:00Z",
      hourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    const windows = [...taf.raw.matchAll(/\bBECMG\s+(\d{4})\/(\d{4})/g)];
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      const span = ddhhSpanHours(w[1]!, w[2]!);
      expect(span).toBeGreaterThan(0);
      expect(span).toBeLessThanOrEqual(2);
    }
    expect(taf.raw).toMatch(/BECMG 1714\/1716\b[^\n]*\bBR\b/);
    const check = assertModelTafFormat(taf.raw);
    expect(check.ok, check.ok ? "" : check.reasons.join("; ")).toBe(true);
    expect(check.warnings).toEqual([]);
  });

  it("a 2 h BR event is one TEMPO covering both hours", () => {
    const n = 8;
    const br = (i: number) => i === 2 || i === 3;
    const hourly = {
      time: Array.from({ length: n }, (_, i) => `2026-11-17T${String(12 + i).padStart(2, "0")}:00`),
      temperature_2m: Array(n).fill(12),
      dew_point_2m: Array.from({ length: n }, (_, i) => (br(i) ? 10 : 1)),
      relative_humidity_2m: Array.from({ length: n }, (_, i) => (br(i) ? 85 : 40)),
      pressure_msl: Array(n).fill(1014),
      wind_speed_10m: Array(n).fill(16),
      wind_direction_10m: Array(n).fill(180),
      wind_gusts_10m: Array(n).fill(18),
      visibility: Array.from({ length: n }, (_, i) => (br(i) ? 3000 : 9999)),
      precipitation: Array(n).fill(0),
      rain: Array(n).fill(0),
      showers: Array(n).fill(0),
      surface_pressure: Array(n).fill(980),
      cloud_cover_low: Array(n).fill(10),
      cloud_cover_925hPa: Array(n).fill(10),
      geopotential_height_925hPa: Array(n).fill(1600),
    };
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T12:00:00Z",
      hourly,
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    expect(taf.raw).toMatch(/TEMPO 1714\/1716\b[^\n]*\bBR\b/);
    expect(taf.raw).not.toMatch(/TEMPO 1715\/1716/);
  });

  it("rejects a BECMG over 4 h and warns over 2 h", () => {
    const head = "MODEL OUTPUT — NOT OFFICIAL\nTAF SCTB 171200Z 1712/1812 18008KT 9999 NSC";
    const over = assertModelTafFormat(`${head} BECMG 1712/1718 18008KT 9999 NSC RMK GEN=x`);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.reasons.join(" ")).toMatch(/never over 4 h/);
    const warn = assertModelTafFormat(`${head} BECMG 1712/1715 18008KT 9999 NSC RMK GEN=x`);
    expect(warn.ok).toBe(true);
    expect(warn.warnings.join(" ")).toMatch(/normally 2 h or less/);
    const ok = assertModelTafFormat(`${head} BECMG 1712/1714 18008KT 9999 NSC RMK GEN=x`);
    expect(ok.ok).toBe(true);
    expect(ok.warnings).toEqual([]);
  });

  it("clamps a BECMG ending at the next day's 00 to the validity hour 24", () => {
    const n = 36;
    const time: string[] = [];
    const wind: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date("2026-11-17T18:00:00Z");
      d.setUTCHours(d.getUTCHours() + i);
      const iso = d.toISOString().slice(0, 16);
      time.push(iso);
      wind.push(iso >= "2026-11-18T23:00" ? 50 : 18);
    }
    const fill = (value: number) => Array(n).fill(value);
    const taf = generateModelTaf({
      icao: "SCTB",
      elevM: 649,
      model: "gfs_seamless",
      runTime: "2026-11-17T23:17:00Z",
      hourly: {
        time,
        temperature_2m: fill(16),
        dew_point_2m: fill(6),
        relative_humidity_2m: fill(40),
        visibility: fill(9999),
        wind_speed_10m: wind,
        wind_direction_10m: fill(200),
        wind_gusts_10m: wind,
        precipitation: fill(0),
        rain: fill(0),
        showers: fill(0),
        surface_pressure: fill(980),
        cloud_cover_low: fill(5),
        cloud_cover_925hPa: fill(5),
        geopotential_height_925hPa: fill(1600),
      },
    });
    expect("error" in taf).toBe(false);
    if ("error" in taf) return;
    expect(taf.raw).toMatch(/\b1800\/1824\b/);
    expect(taf.raw).toMatch(/\bBECMG 1823\/1824\b/);
    expect(taf.raw).not.toMatch(/\/1900\b/);
    const check = assertModelTafFormat(taf.raw);
    expect(check.ok, check.ok ? "" : check.reasons.join("; ")).toBe(true);
  });

  it("writes a validity period ending at midnight as DD24", () => {
    const from = new Date("2026-11-18T12:00:00Z");
    const midnight = new Date("2026-11-19T00:00:00Z");
    expect(`${tafDdhh(from.toISOString())}/${tafValidityEnd(from, midnight)}`).toBe("1812/1824");
    const nextNoon = new Date("2026-11-19T12:00:00Z");
    expect(`${tafDdhh(from.toISOString())}/${tafValidityEnd(from, nextNoon)}`).toBe("1812/1912");
  });

  it("rejects a group past the validity end and a midnight coded as 00", () => {
    const head = "MODEL OUTPUT — NOT OFFICIAL\nTAF SCTB 172317Z 1800/1824 VRB01KT 9999 NSC";
    const past = assertModelTafFormat(`${head} BECMG 1822/1902 18008KT 9999 NSC RMK GEN=x`);
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.reasons.join(" ")).toMatch(/outside validity 1800\/1824/);
    const midnight = assertModelTafFormat(`${head} BECMG 1823/1900 VRB01KT 9999 NSC RMK GEN=x`);
    expect(midnight.ok).toBe(false);
    if (!midnight.ok) expect(midnight.reasons.join(" ")).toMatch(/1823\/1900/);
    const badPeriod = assertModelTafFormat(
      "MODEL OUTPUT — NOT OFFICIAL\nTAF SCTB 181100Z 1812/1900 18008KT 9999 NSC RMK GEN=x"
    );
    expect(badPeriod.ok).toBe(false);
    if (!badPeriod.ok) expect(badPeriod.reasons.join(" ")).toMatch(/1812\/1900/);
    const noon = assertModelTafFormat(
      "MODEL OUTPUT — NOT OFFICIAL\nTAF SCTB 181100Z 1812/1912 18008KT 9999 NSC RMK GEN=x"
    );
    expect(noon.ok).toBe(true);
    const kept = assertModelTafFormat(`${head} BECMG 1823/1824 VRB01KT 9999 NSC RMK GEN=x`);
    expect(kept.ok).toBe(true);
  });
});

function ddhhSpanHours(from: string, to: string): number {
  const fDay = Number(from.slice(0, 2));
  const tDay = Number(to.slice(0, 2));
  const fHour = Number(from.slice(2, 4));
  const tHour = Number(to.slice(2, 4));
  let days = tDay - fDay;
  if (days < 0) days += 31;
  return days * 24 + (tHour - fHour);
}