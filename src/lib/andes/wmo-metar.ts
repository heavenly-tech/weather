import { ceilingFromHourly } from "@/lib/andes/ceiling";
import type { AndesModelId } from "@/lib/andes/models";
import { parseUtcIso } from "@/lib/andes/parse-utc";
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
  const d = parseUtcIso(iso);
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
  if (kt == null) return "/////KT";
  if (kt < 1) return "00000KT";
  const gustKt = gustKmh != null ? kmhToKt(gustKmh) : null;
  if (dir == null) {
    const base = `VRB${String(Math.round(kt)).padStart(2, "0")}`;
    if (gustKt != null && gustKt >= kt + 10) return `${base}G${String(Math.round(gustKt)).padStart(2, "0")}KT`;
    return `${base}KT`;
  }
  const deg = Math.round(dir / 10) * 10 || 360;
  const ddd = String(deg === 0 ? 360 : deg).padStart(3, "0");
  const ff = String(Math.round(kt)).padStart(2, "0");
  if (gustKt != null && gustKt >= kt + 10) {
    return `${ddd}${ff}G${String(Math.round(gustKt)).padStart(2, "0")}KT`;
  }
  return `${ddd}${ff}KT`;
}

function formatTempGroup(tempC: number | null, dewC: number | null): string {
  if (tempC == null || dewC == null) return "/////";
  const fmt = (n: number) => {
    if (n < 0) return `M${String(Math.round(Math.abs(n))).padStart(2, "0")}`;
    if (n > -0.5 && n < 0) return "M00";
    return String(Math.round(n)).padStart(2, "0");
  };
  return `${fmt(tempC)}/${fmt(dewC)}`;
}

function formatQnh(hpa: number | null): string {
  if (hpa == null) return "";
  return `Q${String(Math.floor(hpa)).padStart(4, "0")}`;
}

function cloudGroup(
  ceilFt: number | null,
  coverLow: number | null,
  coverMid: number | null,
  lowUnresolved: boolean
): string {
  if (ceilFt != null && ceilFt <= 0) return "VV///";
  if (ceilFt != null) {
    const h = Math.floor(ceilFt / 100);
    const code = coverLow != null && coverLow >= 87.5 ? "OVC" : "BKN";
    return `${code}${String(h).padStart(3, "0")}`;
  }
  if (lowUnresolved) return "NSC";
  const cov = coverLow ?? 0;
  if (cov <= 0) return "NSC";
  if (cov < 12.5) return "FEW000";
  if (cov < 37.5) return "SCT000";
  return "NCD";
}

const WX: Record<number, { code: string; heavy?: boolean }> = {
  45: { code: "FG" },
  48: { code: "FG" },
  51: { code: "DZ" },
  53: { code: "DZ" },
  55: { code: "DZ", heavy: true },
  61: { code: "RA" },
  63: { code: "RA" },
  65: { code: "RA", heavy: true },
  71: { code: "SN" },
  73: { code: "SN" },
  75: { code: "SN", heavy: true },
  80: { code: "SHRA" },
  81: { code: "SHRA", heavy: true },
  95: { code: "TSRA" },
};

function presentWeather(wx: number | null, visM: number | null): string {
  const parts: string[] = [];
  if (wx != null && WX[wx]) {
    const e = WX[wx]!;
    const prefix = e.heavy ? "+" : wx < 63 ? "-" : "";
    parts.push(`${prefix}${e.code}`);
  }
  if (visM != null && visM < 1000 && !parts.some((p) => p.includes("FG"))) parts.push("FG");
  else if (visM != null && visM < 5000 && !parts.includes("BR") && !parts.some((p) => p.includes("FG"))) {
    parts.push("BR");
  }
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
  const coverMid = numAt(opts.hourly, "cloud_cover_mid", i);
  const ceil = ceilingFromHourly(opts.hourly, i, opts.elevM);

  const visG = visM != null ? String(visM).padStart(4, "0") : "////";
  const wind = formatModelWind(
    numAt(opts.hourly, "wind_direction_10m", i),
    numAt(opts.hourly, "wind_speed_10m", i),
    numAt(opts.hourly, "wind_gusts_10m", i)
  );
  const wx = presentWeather(wxCode, visM);
  const clouds = cloudGroup(ceil.ceilingFtAgl, coverLow, coverMid, ceil.lowCloudUnresolved);
  const qnhG = formatQnh(qnh);
  const body = [
    opts.icao,
    metarDdhhmmZ(opts.validTime),
    wind,
    visG,
    wx,
    clouds,
    formatTempGroup(temp, dew),
    qnhG,
  ]
    .filter(Boolean)
    .join(" ");

  const raw = `${STAMP}\nMETAR ${body} RMK GEN=${opts.runTime} MODEL=${opts.model}`;
  return { raw, stamp: STAMP };
}