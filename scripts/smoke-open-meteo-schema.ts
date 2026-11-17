/**
 * Live schema smoke: assert each model accepts hourlyVariablesForModel().
 * Run: npx tsx scripts/smoke-open-meteo-schema.ts
 * CI: optional OPEN_METEO_SCHEMA_SMOKE=1
 */

import { ANDES_MODELS, hourlyVariablesForModel } from "../src/lib/andes/models";

const LAT = -33.456;
const LON = -70.546;

async function probe(model: string, hourly: string): Promise<{ ok: boolean; status: number; reason?: string }> {
  const params = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    hourly,
    forecast_hours: "1",
    past_hours: "0",
    models: model,
    timezone: "UTC",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, reason: text.slice(0, 280) };
  }
  return { ok: true, status: res.status };
}

async function main() {
  let failed = 0;
  for (const meta of ANDES_MODELS) {
    for (const mode of ["point", "validate"] as const) {
      const hourly = hourlyVariablesForModel(meta, mode);
      const r = await probe(meta.query, hourly);
      console.log(
        `${meta.id} ${mode}: ${r.ok ? "OK" : "FAIL"} HTTP ${r.status}${r.reason ? ` — ${r.reason}` : ""}`
      );
      if (!r.ok) failed++;
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});