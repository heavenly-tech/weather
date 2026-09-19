import type { ChileFirId, LatLon } from "./types";

export type Station = {
  icao: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  elevM: number;
  fir: ChileFirId | "INTL";
  meteochileId?: string;
};

export const STATIONS: Station[] = [
  { icao: "SCAR", name: "Chacalluta", city: "Arica", lat: -18.348, lon: -70.339, elevM: 51, fir: "ANTOFAGASTA" },
  { icao: "SCDA", name: "Diego Aracena", city: "Iquique", lat: -20.535, lon: -70.181, elevM: 48, fir: "ANTOFAGASTA" },
  { icao: "SCCF", name: "El Loa", city: "Calama", lat: -22.498, lon: -68.908, elevM: 2293, fir: "ANTOFAGASTA" },
  { icao: "SCFA", name: "Cerro Moreno", city: "Antofagasta", lat: -23.444, lon: -70.445, elevM: 139, fir: "ANTOFAGASTA" },
  { icao: "SCAT", name: "Desierto de Atacama", city: "Copiapó", lat: -27.261, lon: -70.779, elevM: 204, fir: "ANTOFAGASTA" },
  { icao: "SCSE", name: "La Florida", city: "La Serena", lat: -29.916, lon: -71.199, elevM: 146, fir: "SANTIAGO" },
  { icao: "SCVM", name: "Viña del Mar", city: "Viña del Mar", lat: -32.95, lon: -71.479, elevM: 141, fir: "SANTIAGO" },
  { icao: "SCEL", name: "Arturo Merino Benítez", city: "Santiago", lat: -33.393, lon: -70.786, elevM: 474, fir: "SANTIAGO", meteochileId: "330021" },
  { icao: "SCTB", name: "Eulogio Sánchez", city: "Tobalaba", lat: -33.456, lon: -70.546, elevM: 649, fir: "SANTIAGO" },
  { icao: "SCSN", name: "Santo Domingo", city: "Santo Domingo", lat: -33.655, lon: -71.614, elevM: 77, fir: "SANTIAGO" },
  { icao: "SCIE", name: "Carriel Sur", city: "Concepción", lat: -36.773, lon: -73.063, elevM: 8, fir: "SANTIAGO" },
  { icao: "SCQP", name: "La Araucanía", city: "Temuco", lat: -38.767, lon: -72.637, elevM: 92, fir: "PUERTO_MONTT" },
  { icao: "SCVD", name: "Pichoy", city: "Valdivia", lat: -39.65, lon: -73.086, elevM: 18, fir: "PUERTO_MONTT" },
  { icao: "SCJO", name: "Cañal Bajo", city: "Osorno", lat: -40.611, lon: -73.061, elevM: 59, fir: "PUERTO_MONTT" },
  { icao: "SCTE", name: "El Tepual", city: "Puerto Montt", lat: -41.439, lon: -73.094, elevM: 90, fir: "PUERTO_MONTT" },
  { icao: "SCBA", name: "Balmaceda", city: "Balmaceda", lat: -45.916, lon: -71.689, elevM: 520, fir: "PUERTO_MONTT" },
  { icao: "SCNT", name: "Teniente Gallardo", city: "Puerto Natales", lat: -51.671, lon: -72.529, elevM: 67, fir: "PUERTO_MONTT" },
  { icao: "SCCI", name: "Carlos Ibáñez", city: "Punta Arenas", lat: -53.002, lon: -70.855, elevM: 38, fir: "PUERTO_MONTT" },
  { icao: "SCIP", name: "Mataveri", city: "Isla de Pascua", lat: -27.165, lon: -109.427, elevM: 48, fir: "INTL" },
  { icao: "SPJC", name: "Jorge Chávez", city: "Lima", lat: -12.022, lon: -77.114, elevM: 34, fir: "INTL" },
  { icao: "SAEZ", name: "Ministro Pistarini", city: "Ezeiza", lat: -34.822, lon: -58.536, elevM: 21, fir: "INTL" },
];

export const DEFAULT_ICAO = "SCEL";

export function getStation(icao: string): Station | undefined {
  return STATIONS.find((s) => s.icao === icao.toUpperCase());
}

export function requireStation(icao: string): Station {
  return getStation(icao) ?? STATIONS.find((s) => s.icao === DEFAULT_ICAO)!;
}

export function searchStations(query: string): Station[] {
  const q = query.trim().toUpperCase();
  if (!q) return STATIONS.filter((s) => s.fir !== "INTL");
  return STATIONS.filter((s) => {
    const blob = `${s.icao} ${s.name} ${s.city}`.toUpperCase();
    return blob.includes(q);
  });
}

export function chileStations(): Station[] {
  return STATIONS.filter((s) => s.fir !== "INTL");
}

export function stationLatLon(icao: string): LatLon {
  const s = requireStation(icao);
  return { lat: s.lat, lon: s.lon };
}

export const FIRS: { id: ChileFirId; label: string; icaoHint: string }[] = [
  { id: "ANTOFAGASTA", label: "Antofagasta FIR", icaoHint: "SCFA" },
  { id: "SANTIAGO", label: "Santiago FIR", icaoHint: "SCEL" },
  { id: "PUERTO_MONTT", label: "Puerto Montt FIR", icaoHint: "SCTE" },
];

export function firForStation(icao: string): ChileFirId {
  const s = getStation(icao);
  if (!s || s.fir === "INTL") return "SANTIAGO";
  return s.fir;
}
