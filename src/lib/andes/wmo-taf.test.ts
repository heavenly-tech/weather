import { describe, expect, it } from "vitest";
import { assertModelTafFormat } from "@/lib/andes/taf-format";
import { generateModelTaf } from "@/lib/andes/wmo-taf";
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
      runTime: "2026-11-17T11:00:00Z",
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
});