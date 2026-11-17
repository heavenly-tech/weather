/** Open-Meteo returns `YYYY-MM-DDTHH:00` without a zone — always treat as UTC. */
export function parseUtcIso(iso: string): Date {
  const normalized = iso.endsWith("Z") ? iso : `${iso}Z`;
  return new Date(normalized);
}