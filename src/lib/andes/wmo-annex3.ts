const VIS_THRESHOLDS_M = [150, 350, 600, 800, 1500, 3000, 5000] as const;
const CEIL_THRESHOLDS_FT = [100, 200, 500, 1000, 1500, 3000] as const;

export function roundVisTaf(m: number): string {
  if (m >= 9990) return "9999";
  if (m < 800) return String(Math.floor(m / 50) * 50).padStart(4, "0");
  if (m < 5000) return String(Math.floor(m / 100) * 100).padStart(4, "0");
  return String(Math.min(9999, Math.floor(m / 1000) * 1000)).padStart(4, "0");
}

export function visCategory(m: number | null): number {
  if (m == null) return VIS_THRESHOLDS_M.length;
  for (let i = 0; i < VIS_THRESHOLDS_M.length; i++) {
    if (m < VIS_THRESHOLDS_M[i]!) return i;
  }
  return VIS_THRESHOLDS_M.length;
}

export function ceilCategory(ft: number | null): number {
  if (ft == null) return CEIL_THRESHOLDS_FT.length;
  for (let i = 0; i < CEIL_THRESHOLDS_FT.length; i++) {
    if (ft < CEIL_THRESHOLDS_FT[i]!) return i;
  }
  return CEIL_THRESHOLDS_FT.length;
}

export function windDirDelta(a: number, b: number): number {
  const d = Math.abs(((b - a + 540) % 360) - 180);
  return d;
}

export function windSignificant(
  dirA: number | null,
  ktA: number | null,
  dirB: number | null,
  ktB: number | null
): boolean {
  if (ktA == null || ktB == null) return false;
  if (Math.abs(ktA - ktB) >= 10) return true;
  if (dirA != null && dirB != null && ktA >= 10 && ktB >= 10) {
    if (windDirDelta(dirA, dirB) >= 60) return true;
  }
  return false;
}

export function visSignificant(aM: number | null, bM: number | null): boolean {
  return visCategory(aM) !== visCategory(bM);
}

export function ceilSignificant(aFt: number | null, bFt: number | null): boolean {
  return ceilCategory(aFt) !== ceilCategory(bFt);
}

export function wxSignificant(
  a: { dir: number | null; kt: number | null; visM: number | null; ceilFt: number | null; wx?: string },
  b: { dir: number | null; kt: number | null; visM: number | null; ceilFt: number | null; wx?: string }
): boolean {
  return (
    windSignificant(a.dir, a.kt, b.dir, b.kt) ||
    visSignificant(a.visM, b.visM) ||
    ceilSignificant(a.ceilFt, b.ceilFt) ||
    (a.wx ?? "") !== (b.wx ?? "")
  );
}