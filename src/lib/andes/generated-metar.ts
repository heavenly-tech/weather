import { ceilingFromHourly } from "@/lib/andes/ceiling";
import type { AndesModelId } from "@/lib/andes/models";
import { kmhToKt } from "@/lib/format";

const STAMP = "MODEL OUTPUT — NOT OFFICIAL";

type Hourly = Record<string, Array<number | null> | string[]>;

function numAt(hourly: Hourly, key: string, index: number): number | null {
  const series = hourly[key];
  if (!series) return null;
  const value = series[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatWind(dir: number | null, kt: number | null): string {
  if (dir == null || kt == null) return "00000KT";
  return `${String(Math.round(dir)).padStart(3, "0")}${String(Math.round(kt)).padStart(2, "0")}KT`;
}

function formatVis(m: number | null): string {
  if (m == null) return "9999";
  if (m >= 9999) return "9999";
  return String(Math.round(m)).padStart(4, "0");
}

export function generateModelMetar(opts: {
  icao: string;
  lat: number;
  lon: number;
  elevM: number;
  model: AndesModelId;
  runTime: string;
  validTime: string;
  hourly: Hourly;
  hourIndex: number;
  cloudBaseKey: string | null;
}): { raw: string; stamp: string } {
  const i = opts.hourIndex;
  const wx = numAt(opts.hourly, "weather_code", i);
  const visM = numAt(opts.hourly, "visibility", i) ?? 9999;
  const windKt = kmhToKt(numAt(opts.hourly, "wind_speed_10m", i));
  const windDir = numAt(opts.hourly, "wind_direction_10m", i);
  const temp = numAt(opts.hourly, "temperature_2m", i);
  const ceil = ceilingFromHourly(opts.hourly, i, opts.elevM, opts.cloudBaseKey);

  const t = opts.validTime.replace(/[-:]/g, "").slice(0, 12);
  const clouds =
    ceil.ceilingFtAgl != null
      ? `BKN${String(Math.round(ceil.ceilingFtAgl / 100)).padStart(3, "0")}`
      : "SKC";

  const tempStr = temp != null ? `${temp > 0 ? "+" : ""}${Math.round(temp)}` : "M00";
  const qnh = "Q1013";

  const body = `${opts.icao} ${t}Z AUTO ${formatWind(windDir, windKt)} ${formatVis(visM)} ${clouds} ${tempStr}/${tempStr} ${qnh}`;
  const remark = `RMK ${STAMP} MODEL=${opts.model} RUN=${opts.runTime} WMO=${wx ?? "NA"}`;
  return { raw: `${body} ${remark}`, stamp: STAMP };
}