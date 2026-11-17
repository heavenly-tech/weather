import { ceilingFromHourly } from "@/lib/andes/ceiling";
import type { AndesModelId } from "@/lib/andes/models";
import { parseUtcIso } from "@/lib/andes/parse-utc";
import {
  roundVisTaf,
  wxSignificant,
} from "@/lib/andes/wmo-annex3";
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
  const d = parseUtcIso(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

export function tafDdhh(iso: string): string {
  const d = parseUtcIso(iso);
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

type PeriodWx = {
  wind: string;
  vis: string;
  cloud: string;
  cat: FlightCategory;
  ceilFt: number | null;
  dir: number | null;
  kt: number | null;
  visM: number | null;
};

function periodWx(hourly: Hourly, index: number, elevM: number): PeriodWx {
  const ceil = ceilingFromHourly(hourly, index, elevM);
  const visM = numAt(hourly, "visibility", index);
  const windKt = kmhToKt(numAt(hourly, "wind_speed_10m", index));
  const windDir = numAt(hourly, "wind_direction_10m", index);
  const wind =
    windKt != null && windKt >= 1 && windDir != null
      ? `${String(Math.round(windDir / 10) * 10 || 360).padStart(3, "0")}${String(Math.round(windKt)).padStart(2, "0")}KT`
      : "/////KT";
  const vis = roundVisTaf(visM);
  const cloud =
    ceil.ceilingFtAgl != null
      ? `${ceil.ceilingFtAgl <= 0 ? "VV" : "BKN"}${String(Math.max(0, Math.floor(ceil.ceilingFtAgl / 100))).padStart(3, "0")}`
      : ceil.lowCloudUnresolved
        ? "NSC"
        : "NSC";
  return {
    wind,
    vis,
    cloud,
    cat: ceil.ceilingCategory,
    ceilFt: ceil.ceilingFtAgl,
    dir: windDir,
    kt: windKt,
    visM,
  };
}

function groupString(wx: PeriodWx): string {
  return `${wx.wind} ${wx.vis} ${wx.cloud}`;
}

function toSignificant(a: PeriodWx) {
  return { dir: a.dir, kt: a.kt, visM: a.visM, ceilFt: a.ceilFt };
}

function lastIndexBefore(times: string[], end: Date): number {
  let last = 0;
  times.forEach((t, i) => {
    if (parseUtcIso(t).getTime() <= end.getTime()) last = i;
  });
  return last;
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

  const issue = parseUtcIso(opts.runTime);
  const validFrom = nextSynopticAfter(issue);
  const validTo = new Date(validFrom);
  validTo.setUTCHours(validTo.getUTCHours() + 24);

  const fromIdx = times.findIndex((t) => parseUtcIso(t).getTime() >= validFrom.getTime());
  const baseIdx = fromIdx >= 0 ? fromIdx : 0;
  const endIdx = lastIndexBefore(times, validTo);
  if (endIdx <= baseIdx) return { error: "Validity window outside model hours" };

  const base = periodWx(opts.hourly, baseIdx, opts.elevM);
  const header = `TAF ${opts.icao} ${tafDdhhmmZ(opts.runTime)} ${tafDdhh(validFrom.toISOString())}/${tafDdhh(validTo.toISOString())}`;
  const changes: { order: number; text: string }[] = [];

  let prevailing = base;
  let i = baseIdx + 1;
  while (i <= endIdx) {
    const wx = periodWx(opts.hourly, i, opts.elevM);
    if (!wxSignificant(toSignificant(prevailing), toSignificant(wx))) {
      i++;
      continue;
    }

    const windowEndIdx = Math.min(i + 2, endIdx);
    const atEnd = periodWx(opts.hourly, windowEndIdx, opts.elevM);
    const windowEndTime = parseUtcIso(times[windowEndIdx]!);
    if (windowEndTime.getTime() > validTo.getTime()) break;

    const persistent =
      wxSignificant(toSignificant(prevailing), toSignificant(wx)) &&
      wxSignificant(toSignificant(prevailing), toSignificant(atEnd));

    if (persistent) {
      const t0 = tafDdhh(times[i]!);
      const t1 = tafDdhh(times[windowEndIdx]!);
      changes.push({ order: parseUtcIso(times[i]!).getTime(), text: `BECMG ${t0}/${t1} ${groupString(atEnd)}` });
      prevailing = atEnd;
      i = windowEndIdx + 1;
      continue;
    }

    if (i + 1 <= endIdx) {
      const revert = periodWx(opts.hourly, i + 1, opts.elevM);
      if (wxSignificant(toSignificant(prevailing), toSignificant(wx)) && !wxSignificant(toSignificant(prevailing), toSignificant(revert))) {
        const endI = Math.min(i + 1, endIdx);
        if (parseUtcIso(times[endI]!).getTime() <= validTo.getTime()) {
          changes.push({
            order: parseUtcIso(times[i]!).getTime(),
            text: `TEMPO ${tafDdhh(times[i]!)}/${tafDdhh(times[endI]!)} ${groupString(wx)}`,
          });
        }
      }
    }
    i++;
  }

  const pIdx = baseIdx + 12;
  if (pIdx <= endIdx) {
    const precip = numAt(opts.hourly, "precipitation", pIdx);
    if (precip != null && precip > 0.2) {
      const pEnd = Math.min(pIdx + 2, endIdx);
      const endTime = parseUtcIso(times[pEnd]!);
      if (endTime.getTime() <= validTo.getTime()) {
        changes.push({
          order: parseUtcIso(times[pIdx]!).getTime(),
          text: `PROB30 ${tafDdhh(times[pIdx]!)}/${tafDdhh(times[pEnd]!)} RA`,
        });
      }
    }
  }

  changes.sort((a, b) => a.order - b.order);
  const body = [groupString(base), ...changes.map((c) => c.text)].filter(Boolean).join(" ");
  const raw = `${STAMP}\n${header} ${body} RMK GEN=${opts.runTime} MODEL=${opts.model}`;
  return { raw, stamp: STAMP };
}

export function assertTafChangeCountForFixture(
  hourly: Hourly,
  opts: { elevM: number; runTime: string; maxBecmg: number }
): boolean {
  const r = generateModelTaf({
    icao: "SCEL",
    elevM: opts.elevM,
    model: "gfs_seamless",
    runTime: opts.runTime,
    hourly,
  });
  if ("error" in r) return false;
  const becmg = (r.raw.match(/\bBECMG\b/g) ?? []).length;
  return becmg <= opts.maxBecmg;
}