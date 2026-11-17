import { ceilingFromHourly } from "@/lib/andes/ceiling";
import type { AndesModelId } from "@/lib/andes/models";
import { parseUtcIso } from "@/lib/andes/parse-utc";
import { deriveMetarWxAndCloud } from "@/lib/andes/wmo-metar-wx";
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
  const qnh = numAt(opts.hourly, "pressure_msl", i);
  const ceil = ceilingFromHourly(opts.hourly, i, opts.elevM);
  const derived = deriveMetarWxAndCloud(opts.hourly, i, opts.elevM, ceil, visM, false);

  const visG = visM != null ? String(visM).padStart(4, "0") : "////";
  const wind = formatModelWind(
    numAt(opts.hourly, "wind_direction_10m", i),
    numAt(opts.hourly, "wind_speed_10m", i),
    numAt(opts.hourly, "wind_gusts_10m", i)
  );
  const wx = derived.weather;
  const clouds = derived.clouds;
  const qnhG = formatQnh(qnh);
  const body = [
    opts.icao,
    metarDdhhmmZ(opts.validTime),
    wind,
    visG,
    wx,
    clouds,
    formatTempGroup(numAt(opts.hourly, "temperature_2m", i), numAt(opts.hourly, "dew_point_2m", i)),
    qnhG,
  ]
    .filter(Boolean)
    .join(" ");

  const rmkParts = [`GEN=${opts.runTime}`, `MODEL=${opts.model}`, ...derived.rmkExtra];
  const raw = `${STAMP}\nMETAR ${body} RMK ${rmkParts.join(" ")}`;
  return { raw, stamp: STAMP };
}