import { ceilingFromHourly } from "@/lib/andes/ceiling";
import type { AndesModelId } from "@/lib/andes/models";
import { parseUtcIso } from "@/lib/andes/parse-utc";
import { wxSignificant, roundVisTaf } from "@/lib/andes/wmo-annex3";
import { deriveMetarWxAndCloud } from "@/lib/andes/wmo-metar-wx";
import { formatModelWind, STAMP } from "@/lib/andes/wmo-metar";
import { resolveVisibilityMeters } from "@/lib/andes/visibility-estimate";
import { kmhToKt } from "@/lib/format";
import type { FlightCategory } from "@/lib/types";

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

export function tafValidityEnd(from: Date, to: Date): string {
  if (to.getUTCHours() === 0) {
    const endCal = new Date(to);
    endCal.setUTCDate(endCal.getUTCDate() - 1);
    return `${String(endCal.getUTCDate()).padStart(2, "0")}24`;
  }
  return tafDdhh(to.toISOString());
}

export function validityFromIssue(issue: Date): { from: Date; to: Date } {
  const from = new Date(issue);
  from.setUTCSeconds(0, 0);
  from.setUTCMinutes(0);
  if (issue.getUTCMinutes() > 0 || issue.getUTCSeconds() > 0) {
    from.setUTCHours(from.getUTCHours() + 1);
  }
  const to = new Date(from);
  to.setUTCHours(to.getUTCHours() + 24);
  return { from, to };
}

type PeriodWx = {
  wind: string;
  vis: string;
  cloud: string;
  wx: string;
  cat: FlightCategory;
  ceilFt: number | null;
  dir: number | null;
  kt: number | null;
  visM: number | null;
  cldEstimated: boolean;
  midCloudBaseUnk: boolean;
};

function periodWx(hourly: Hourly, index: number, elevM: number, model: AndesModelId, icao: string): PeriodWx {
  const ceil = ceilingFromHourly(hourly, index, elevM);
  const resolved = resolveVisibilityMeters(hourly, index, model);
  const visM = resolved.visM;
  const visRound = visM != null ? (visM >= 9990 ? 9999 : visM) : null;
  const wind = formatModelWind(
    numAt(hourly, "wind_direction_10m", index),
    numAt(hourly, "wind_speed_10m", index),
    numAt(hourly, "wind_gusts_10m", index)
  );
  const vis = visM != null ? roundVisTaf(visM) : "9999";
  const derived = deriveMetarWxAndCloud(hourly, index, elevM, icao, ceil, visRound, true);
  return {
    wind,
    vis,
    cloud: derived.clouds,
    wx: derived.weather,
    cat: ceil.ceilingCategory,
    ceilFt: derived.effectiveCeilFt ?? ceil.ceilingFtAgl,
    dir: numAt(hourly, "wind_direction_10m", index),
    kt: kmhToKt(numAt(hourly, "wind_speed_10m", index)),
    visM,
    cldEstimated: derived.cldEstimated,
    midCloudBaseUnk: derived.midCloudBaseUnk,
  };
}

function groupString(wx: PeriodWx, opts?: { priorWx?: string }): string {
  const parts = [wx.wind, wx.vis];
  if (wx.wx) parts.push(wx.wx);
  if (wx.visM != null && wx.visM < 5000 && !wx.wx) {
    parts.push(wx.visM < 1000 ? "FG" : "BR");
  }
  if (opts?.priorWx && !wx.wx) parts.push("NSW");
  parts.push(wx.cloud);
  return parts.filter(Boolean).join(" ");
}

function toSignificant(a: PeriodWx) {
  return { dir: a.dir, kt: a.kt, visM: a.visM, ceilFt: a.ceilFt, wx: a.wx };
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
}): { raw: string; stamp: string; visEstimated?: boolean; cldEstimated?: boolean; midCloudBaseUnk?: boolean } | { error: string } {
  const times = (opts.hourly.time ?? []) as string[];
  if (times.length < 2) return { error: "Insufficient model hours for TAF" };

  const issue = parseUtcIso(opts.runTime);
  const { from: validFrom, to: validTo } = validityFromIssue(issue);

  const fromIdx = times.findIndex((t) => parseUtcIso(t).getTime() >= validFrom.getTime());
  const baseIdx = fromIdx >= 0 ? fromIdx : 0;
  const endIdx = lastIndexBefore(times, validTo);
  if (endIdx <= baseIdx) return { error: "Validity window outside model hours" };

  const base = periodWx(opts.hourly, baseIdx, opts.elevM, opts.model, opts.icao);
  const visEstimated = resolveVisibilityMeters(opts.hourly, baseIdx, opts.model).estimated;
  const header = `TAF ${opts.icao} ${tafDdhhmmZ(opts.runTime)} ${tafDdhh(validFrom.toISOString())}/${tafValidityEnd(validFrom, validTo)}`;
  const changes: { order: number; text: string }[] = [];

  let prevailing = base;
  let i = baseIdx + 1;
  while (i <= endIdx) {
    const wx = periodWx(opts.hourly, i, opts.elevM, opts.model, opts.icao);
    if (!wxSignificant(toSignificant(prevailing), toSignificant(wx))) {
      i++;
      continue;
    }

    let windowEndIdx = Math.min(i + 2, endIdx);
    if (windowEndIdx <= i) {
      i++;
      continue;
    }
    const atEnd = periodWx(opts.hourly, windowEndIdx, opts.elevM, opts.model, opts.icao);
    const windowEndTime = parseUtcIso(times[windowEndIdx]!);
    if (windowEndTime.getTime() > validTo.getTime()) {
      windowEndIdx = Math.max(i, endIdx - 1);
      if (windowEndIdx <= i) break;
    }

    const t0 = tafDdhh(times[i]!);
    const t1 = tafDdhh(times[windowEndIdx]!);
    if (t0 === t1) {
      i++;
      continue;
    }

    const persistent =
      wxSignificant(toSignificant(prevailing), toSignificant(wx)) &&
      wxSignificant(toSignificant(prevailing), toSignificant(atEnd));

    if (persistent) {
      changes.push({
        order: parseUtcIso(times[i]!).getTime(),
        text: `BECMG ${t0}/${t1} ${groupString(atEnd, { priorWx: prevailing.wx })}`,
      });
      prevailing = atEnd;
      i = windowEndIdx + 1;
      continue;
    }

    if (i + 1 <= endIdx) {
      const revert = periodWx(opts.hourly, i + 1, opts.elevM, opts.model, opts.icao);
      if (wxSignificant(toSignificant(prevailing), toSignificant(wx)) && !wxSignificant(toSignificant(prevailing), toSignificant(revert))) {
        const endI = Math.min(i + 1, endIdx);
        const te0 = tafDdhh(times[i]!);
        const te1 = tafDdhh(times[endI]!);
        if (te0 !== te1 && parseUtcIso(times[endI]!).getTime() <= validTo.getTime()) {
          changes.push({
            order: parseUtcIso(times[i]!).getTime(),
            text: `TEMPO ${te0}/${te1} ${groupString(wx)}`,
          });
        }
      }
    }
    i++;
  }

  changes.sort((a, b) => a.order - b.order);
  const body = [groupString(base), ...changes.map((c) => c.text)].filter(Boolean).join(" ");
  const rmkParts = [`GEN=${opts.runTime}`, `MODEL=${opts.model}`];
  if (visEstimated) rmkParts.push("VIS EST");
  if (base.cldEstimated) rmkParts.push("CLD EST");
  if (base.midCloudBaseUnk) rmkParts.push("MID CLD BASE UNK");
  const raw = `${STAMP}\n${header} ${body} RMK ${rmkParts.join(" ")}`;
  return {
    raw,
    stamp: STAMP,
    visEstimated: visEstimated || undefined,
    cldEstimated: base.cldEstimated || undefined,
    midCloudBaseUnk: base.midCloudBaseUnk || undefined,
  };
}