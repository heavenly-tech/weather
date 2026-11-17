/**
 * Shared present weather from visibility + RH (METAR and TAF).
 * FG below 1000 m. From 1000 m through 5000 m inclusive: BR when RH ≥ 80%, otherwise HZ.
 * No obscuration group above 5000 m.
 */
export function visObscurationWx(visM: number | null, rhPct: number | null): string {
  if (visM == null || visM > 5000) return "";
  if (visM < 1000) return "FG";
  if (rhPct != null && rhPct >= 80) return "BR";
  return "HZ";
}