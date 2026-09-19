import { fetchJson } from "./http";
import type { ForecastHour, PointForecast } from "./types";
import { requireStation } from "./stations";

type MeteoChileElement = {
  nombreElemento?: { nombre?: string; campo?: string };
  [key: string]: unknown;
};

type MeteoChilePayload = {
  estacionDatos?: { NombreEstacion?: string; LatitudDecimal?: number; LongitudDecimal?: number };
  elementos?: Record<string, MeteoChileElement>;
};

function flattenHours(payload: MeteoChilePayload): ForecastHour[] {
  const hours = new Map<string, ForecastHour>();

  function ensure(time: string): ForecastHour {
    const existing = hours.get(time);
    if (existing) return existing;
    const created: ForecastHour = {
      time,
      tempC: null,
      rhPct: null,
      precipMm: null,
      cloudPct: null,
      windKt: null,
      windDirDeg: null,
      visKm: null,
      weatherCode: null,
    };
    hours.set(time, created);
    return created;
  }

  const elementos = payload.elementos ?? {};
  for (const value of Object.values(elementos)) {
    const nombre = String(value?.nombreElemento?.nombre ?? "").toLowerCase();
    const campo = String(value?.nombreElemento?.campo ?? "").toLowerCase();
    const label = `${nombre} ${campo}`;
    for (const [key, series] of Object.entries(value)) {
      if (key === "nombreElemento" || !series || typeof series !== "object") continue;
      const points = series as Record<string, { fechaLocal?: string; valorPronosticado?: number; fecha?: string }>;
      for (const point of Object.values(points)) {
        const time = point.fecha ?? point.fechaLocal;
        if (!time || point.valorPronosticado == null) continue;
        const hour = ensure(new Date(time).toISOString());
        const v = point.valorPronosticado;
        if (label.includes("temp")) hour.tempC = v;
        else if (label.includes("humedad") || label.includes("hr")) hour.rhPct = v;
        else if (label.includes("precip") || label.includes("agua")) hour.precipMm = v;
        else if (label.includes("nube") || label.includes("cloud")) hour.cloudPct = v;
        else if (label.includes("viento") && (label.includes("dir") || label.includes("direccion"))) hour.windDirDeg = v;
        else if (label.includes("viento")) hour.windKt = Math.round(v / 1.852);
      }
    }
  }

  return [...hours.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export async function fetchMeteoChileWrf(icao: string): Promise<PointForecast | null> {
  const station = requireStation(icao);
  const user = process.env.METEOCHILE_USER;
  const token = process.env.METEOCHILE_TOKEN;
  if (!user || !token || !station.meteochileId) return null;

  const url = `https://climatologia.meteochile.gob.cl/application/serviciosb/getDatosModelo/${station.meteochileId}?usuario=${encodeURIComponent(user)}&token=${encodeURIComponent(token)}`;
  const result = await fetchJson<MeteoChilePayload>(url, { timeoutMs: 12000 });
  if (!result.ok) return null;
  const hours = flattenHours(result.data);
  if (!hours.length) return null;
  return {
    icao: station.icao,
    name: `${station.city} / ${station.name}`,
    model: "WRF-DMC (MeteoChile)",
    lat: result.data.estacionDatos?.LatitudDecimal ?? station.lat,
    lon: result.data.estacionDatos?.LongitudDecimal ?? station.lon,
    elevM: station.elevM,
    hours,
  };
}
