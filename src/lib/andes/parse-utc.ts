/** Open-Meteo returns `YYYY-MM-DDTHH:00` without a zone — always treat as UTC. */
export function parseUtcIso(iso: string): Date {
  if (iso.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(iso)) return new Date(iso);
  return new Date(`${iso}Z`);
}