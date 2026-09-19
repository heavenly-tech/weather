import type { FlightCategory, PressureLevel } from "./types";

export function kmhToKt(kmh: number | null | undefined): number | null {
  if (kmh == null || Number.isNaN(kmh)) return null;
  return Math.round(kmh / 1.852);
}

export function mToKm(m: number | null | undefined): number | null {
  if (m == null || Number.isNaN(m)) return null;
  return Math.round((m / 1000) * 10) / 10;
}

export function padIcao(id: string): string {
  return id.trim().toUpperCase();
}

export function formatWind(dir: number | null, kt: number | null, gust?: number | null): string {
  if (kt == null) return "—";
  const g = gust && gust > kt ? `G${gust}` : "";
  if (kt === 0) return "Calm";
  if (dir == null) return `VRB / ${kt} kt${g}`;
  const d = String(Math.round(dir)).padStart(3, "0");
  return `${d}° / ${kt} kt${g}`;
}

export function formatTemp(c: number | null | undefined): string {
  if (c == null || Number.isNaN(c)) return "—";
  const rounded = Math.round(c);
  return `${rounded > 0 ? "+" : ""}${rounded} °C`;
}

export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace(".000Z", "Z").replace("T", " ");
}

export function zuluShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}${hh}${mm}Z`;
}

export function unixToIso(unix: number | null | undefined): string | null {
  if (unix == null) return null;
  const ms = unix > 1e12 ? unix : unix * 1000;
  return new Date(ms).toISOString();
}

export const LEVEL_FL: Record<PressureLevel, number> = {
  1000: 5,
  925: 25,
  850: 50,
  700: 100,
  500: 180,
  300: 300,
};

export function flightCategoryColor(cat: FlightCategory): string {
  if (cat === "VFR") return "text-emerald-300";
  if (cat === "MVFR") return "text-sky-300";
  if (cat === "IFR") return "text-amber-300";
  if (cat === "LIFR") return "text-rose-300";
  return "text-muted-foreground";
}

export function flightCategoryBg(cat: FlightCategory): string {
  switch (cat) {
    case "VFR":
      return "bg-emerald-500 text-emerald-950 ring-emerald-300/80";
    case "MVFR":
      return "bg-sky-400 text-sky-950 ring-sky-200/80";
    case "IFR":
      return "bg-amber-400 text-amber-950 ring-amber-200/80";
    case "LIFR":
      return "bg-rose-500 text-rose-50 ring-rose-200/80";
    default:
      return "bg-muted text-muted-foreground ring-foreground/20";
  }
}

export function weatherCodeLabel(code: number | null | undefined): string {
  if (code == null) return "Unknown";
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Thunderstorm";
  return `WMO ${code}`;
}
