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

function tafTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${dd}${hh}`;
}

function periodGroup(hourly: Hourly, index: number, elevM: number, cloudBaseKey: string | null): string {
  const windKt = kmhToKt(numAt(hourly, "wind_speed_10m", index));
  const windDir = numAt(hourly, "wind_direction_10m", index);
  const visM = numAt(hourly, "visibility", index) ?? 9999;
  const ceil = ceilingFromHourly(hourly, index, elevM, cloudBaseKey);
  const wind =
    windDir != null && windKt != null
      ? `${String(Math.round(windDir)).padStart(3, "0")}${String(Math.round(windKt)).padStart(2, "0")}KT`
      : "00000KT";
  const vis = visM >= 9999 ? "9999" : String(Math.round(visM)).padStart(4, "0");
  const cloud =
    ceil.ceilingFtAgl != null
      ? `BKN${String(Math.round(ceil.ceilingFtAgl / 100)).padStart(3, "0")}`
      : "SKC";
  return `${wind} ${vis} ${cloud}`;
}

export function generateModelTaf(opts: {
  icao: string;
  elevM: number;
  model: AndesModelId;
  runTime: string;
  hourly: Hourly;
  cloudBaseKey: string | null;
}): { raw: string; stamp: string } {
  const times = (opts.hourly.time ?? []) as string[];
  if (!times.length) {
    return { raw: `TAF ${opts.icao} XXXX/XXXX ${STAMP}`, stamp: STAMP };
  }

  const start = times[0];
  const end = times[Math.min(times.length - 1, 23)] ?? start;
  const header = `TAF ${opts.icao} ${tafTime(opts.runTime)}Z ${tafTime(start)}/${tafTime(end)}`;

  const groups: string[] = [periodGroup(opts.hourly, 0, opts.elevM, opts.cloudBaseKey)];

  const step = 6;
  for (let i = step; i < Math.min(times.length, 24); i += step) {
    const change = i >= 12 ? "TEMPO" : "BECMG";
    groups.push(`${change} ${tafTime(times[i])}/${tafTime(times[Math.min(i + 3, times.length - 1)])} ${periodGroup(opts.hourly, i, opts.elevM, opts.cloudBaseKey)}`);
  }

  if (numAt(opts.hourly, "precipitation", 12) != null && (numAt(opts.hourly, "precipitation", 12) ?? 0) > 0.2) {
    groups.push(`PROB30 ${tafTime(times[12])}/${tafTime(times[15])} ${periodGroup(opts.hourly, 12, opts.elevM, opts.cloudBaseKey)}`);
  }

  const remark = `RMK ${STAMP} MODEL=${opts.model} RUN=${opts.runTime}`;
  return { raw: `${header} ${groups.join(" ")} ${remark}`, stamp: STAMP };
}