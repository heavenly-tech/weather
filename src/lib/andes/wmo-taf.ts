import { ceilingFromHourly } from "@/lib/andes/ceiling";
import type { AndesModelId } from "@/lib/andes/models";
import { kmhToKt } from "@/lib/format";
import type { FlightCategory } from "@/lib/types";
import { STAMP } from "@/lib/andes/wmo-metar";

type Hourly = Record<string, Array<number | null> | string[]>;

function numAt(hourly: Hourly, key: string, index: number): number | null {
  const series = hourly[key];
  if (!series) return null;
  const value = series[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function tafDdhhmmZ(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

export function tafDdhh(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}`;
}

export function nextSynopticAfter(issue: Date): Date {
  const d = new Date(issue);
  d.setUTCMinutes(0, 0, 0);
  const h = d.getUTCHours();
  const next = [0, 6, 12, 18].find((s) => s > h) ?? 0;
  if (next === 0 && h >= 18) {
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(0);
  } else if (next === 0) {
    d.setUTCHours(0);
  } else {
    d.setUTCHours(next);
  }
  return d;
}

function periodWx(hourly: Hourly, index: number, elevM: number): {
  wind: string;
  vis: string;
  cloud: string;
  cat: FlightCategory;
  ceilFt: number | null;
} {
  const ceil = ceilingFromHourly(hourly, index, elevM);
  const visM = numAt(hourly, "visibility", index);
  const windKt = kmhToKt(numAt(hourly, "wind_speed_10m", index));
  const windDir = numAt(hourly, "wind_direction_10m", index);
  const wind =
    windKt != null && windKt >= 1 && windDir != null
      ? `${String(Math.round(windDir / 10) * 10 || 360).padStart(3, "0")}${String(Math.round(windKt)).padStart(2, "0")}KT`
      : "00000KT";
  const vis = visM != null ? String(Math.min(9999, Math.round(visM))).padStart(4, "0") : "////";
  const cloud =
    ceil.ceilingFtAgl != null
      ? `${ceil.ceilingFtAgl <= 0 ? "VV" : "BKN"}${String(Math.max(0, Math.floor(ceil.ceilingFtAgl / 100))).padStart(3, "0")}`
      : "NSC";
  return { wind, vis, cloud, cat: ceil.ceilingCategory, ceilFt: ceil.ceilingFtAgl };
}

function wxChanged(a: ReturnType<typeof periodWx>, b: ReturnType<typeof periodWx>): boolean {
  const ceilDelta = Math.abs((a.ceilFt ?? 50000) - (b.ceilFt ?? 50000));
  if (ceilDelta >= 1000) return true;
  if (a.cat !== b.cat) return true;
  if (a.vis !== b.vis) return true;
  if (a.wind !== b.wind) return true;
  return false;
}

function groupString(wx: ReturnType<typeof periodWx>): string {
  return `${wx.wind} ${wx.vis} ${wx.cloud}`;
}

export function generateModelTaf(opts: {
  icao: string;
  elevM: number;
  model: AndesModelId;
  runTime: string;
  hourly: Hourly;
}): { raw: string; stamp: string } | { error: string } {
  const times = (opts.hourly.time ?? []) as string[];
  if (times.length < 2) return { error: "Insufficient model hours for TAF" };

  const issue = new Date(opts.runTime);
  const validFrom = nextSynopticAfter(issue);
  const validTo = new Date(validFrom);
  validTo.setUTCHours(validTo.getUTCHours() + 24);

  const fromIdx = times.findIndex((t) => new Date(t).getTime() >= validFrom.getTime());
  const baseIdx = fromIdx >= 0 ? fromIdx : 0;
  const base = periodWx(opts.hourly, baseIdx, opts.elevM);

  const header = `TAF ${opts.icao} ${tafDdhhmmZ(opts.runTime)} ${tafDdhh(validFrom.toISOString())}/${tafDdhh(validTo.toISOString())}`;
  const groups: string[] = [groupString(base)];
  const changes: { order: number; text: string }[] = [];

  for (let i = baseIdx + 1; i < Math.min(times.length, baseIdx + 24); i++) {
    const wx = periodWx(opts.hourly, i, opts.elevM);
    if (!wxChanged(base, wx)) continue;
    const prev = periodWx(opts.hourly, i - 1, opts.elevM);
    const persistent = wxChanged(prev, wx) && i - baseIdx >= 2;
    const tag = persistent ? "BECMG" : "TEMPO";
    const t0 = tafDdhh(times[i]!);
    const t1 = tafDdhh(times[Math.min(i + 2, times.length - 1)]!);
    changes.push({ order: new Date(times[i]!).getTime(), text: `${tag} ${t0}/${t1} ${groupString(wx)}` });
  }

  const pIdx = baseIdx + 12;
  const precip = numAt(opts.hourly, "precipitation", pIdx);
  if (precip != null && precip > 0.2 && pIdx < times.length - 2) {
    changes.push({
      order: new Date(times[pIdx]!).getTime(),
      text: `PROB30 ${tafDdhh(times[pIdx]!)} ${tafDdhh(times[pIdx + 2]!)} RA`,
    });
  }

  changes.sort((a, b) => a.order - b.order);
  const raw = `${STAMP}\n${header} ${groups.join(" ")} ${changes.map((c) => c.text).join(" ")} RMK GEN=${opts.runTime} MODEL=${opts.model}`;
  return { raw, stamp: STAMP };
}