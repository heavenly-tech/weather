import { ceilingFromHourly } from "@/lib/andes/ceiling";
import type { AndesModelId } from "@/lib/andes/models";
import { kmhToKt } from "@/lib/format";

export const STAMP = "MODEL OUTPUT — NOT OFFICIAL";

type Hourly = Record<string, Array<number | null> | string[]>;

function numAt(hourly: Hourly, key: string, index: number): number | null {
  const series = hourly[key];
  if (!series) return null;
  const value = series[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function metarDdhhmmZ(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}${hh}${mm}Z`;
}

function roundVisM(m: number): number {
  if (m >= 9990) return 9999;
  if (m < 800) return Math.round(m / 50) * 50;
  if (m < 5000) return Math.round(m / 100) * 100;
  return Math.min(9999, Math.round(m / 1000) * 1000);
}

export function formatModelWind(dir: number | null, speedKmh: number | null, gustKmh: number | null): string {
  const kt = speedKmh != null ? kmhToKt(speedKmh) : null;
  if (kt == null || kt < 1) return "00000KT";
  if (dir == null) return "VRB" + String(Math.round(kt)).padStart(2, "0") + "KT";
  const deg = kt < 1 ? 0 : Math.round(dir / 10) * 10 || 360;
  const ddd = String(deg === 0 ? 360 : deg).padStart(3, "0");
  let out = `${ddd}${String(Math.round(kt)).padStart(2, "0")}KT`;
  if (gustKmh != null && kmhToKt(gustKmh)! > kt + 5) {
    out += `G${String(Math.round(kmhToKt(gustKmh)!)).padStart(2, "0")}KT`;
  }
  return out;
}

function formatTempGroup(tempC: number | null, dewC: number | null): string {
  if (tempC == null || dewC == null) return "/////";
  const t = Math.round(tempC);
  const d = Math.round(dewC);
  const fmt = (n: number) => (n < 0 ? `M${String(Math.abs(n)).padStart(2, "0")}` : String(n).padStart(2, "0"));
  return `${fmt(t)}/${fmt(d)}`;
}

function formatQnh(hpa: number | null): string {
  if (hpa == null) return "";
  return `Q${String(Math.floor(hpa + 0.5)).padStart(4, "0")}`;
}

function cloudGroup(ceilFt: number | null, coverLow: number | null): string {
  if (ceilFt != null && ceilFt <= 0) return "VV///";
  if (ceilFt == null) return coverLow != null && coverLow > 0 ? "NCD" : "NSC";
  const h = Math.floor(ceilFt / 100);
  const code = h <= 3 ? "OVC" : "BKN";
  return `${code}${String(h).padStart(3, "0")}`;
}

const WX: Record<number, string> = {
  45: "FG",
  48: "FG",
  51: "DZ",
  53: "DZ",
  55: "DZ",
  61: "RA",
  63: "RA",
  65: "RA",
  80: "SHRA",
  81: "SHRA",
  95: "TSRA",
};

function presentWeather(wx: number | null, visM: number | null): string {
  const parts: string[] = [];
  if (wx != null && WX[wx]) parts.push(WX[wx]!);
  if (visM != null && visM < 5000 && !parts.includes("FG") && !parts.includes("BR")) parts.push(visM < 1000 ? "FG" : "BR");
  return parts.length ? parts.join(" ") : "";
}

export function generateModelMetar(opts: {
  icao: string;
  elevM: number;
  model: AndesModelId;
  runTime: string;
  validTime: string;
  hourly: Hourly;
  hourIndex: number;
}): { raw: string; stamp: string } {
  const i = opts.hourIndex;
  const visRaw = numAt(opts.hourly, "visibility", i);
  const visM = visRaw != null ? roundVisM(visRaw) : null;
  const temp = numAt(opts.hourly, "temperature_2m", i);
  const dew = numAt(opts.hourly, "dew_point_2m", i);
  const qnh = numAt(opts.hourly, "pressure_msl", i);
  const wxCode = numAt(opts.hourly, "weather_code", i);
  const coverLow = numAt(opts.hourly, "cloud_cover_low", i);
  const ceil = ceilingFromHourly(opts.hourly, i, opts.elevM);

  const visG = visM != null ? String(visM).padStart(4, "0") : "////";
  const wind = formatModelWind(
    numAt(opts.hourly, "wind_direction_10m", i),
    numAt(opts.hourly, "wind_speed_10m", i),
    numAt(opts.hourly, "wind_gusts_10m", i)
  );
  const wx = presentWeather(wxCode, visM);
  const clouds = cloudGroup(ceil.ceilingFtAgl, coverLow);
  const qnhG = formatQnh(qnh);
  const body = [
    opts.icao,
    metarDdhhmmZ(opts.validTime),
    wind,
    wx,
    visG,
    clouds,
    formatTempGroup(temp, dew),
    qnhG,
  ]
    .filter(Boolean)
    .join(" ");

  const raw = `${STAMP}\nMETAR ${body} RMK GEN=${opts.runTime} MODEL=${opts.model}`;
  return { raw, stamp: STAMP };
}