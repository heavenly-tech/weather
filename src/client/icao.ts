/** Same empty-string fallback as `normalizeIcao` on the Next pages. */
export function clientIcao(value: string | null, fallback: string): string {
  const raw = (value ?? fallback).split(",")[0]?.trim().toUpperCase() ?? "";
  return raw || fallback;
}
