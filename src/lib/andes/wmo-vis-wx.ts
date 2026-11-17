/** Shared present weather from visibility + RH (METAR and TAF). */

export function visObscurationWx(visM: number | null, rhPct: number | null): string {
  if (visM == null || visM >= 5000) return "";
  if (visM < 1000) return "FG";
  if (rhPct != null && rhPct >= 80) return "BR";
  return "HZ";
}