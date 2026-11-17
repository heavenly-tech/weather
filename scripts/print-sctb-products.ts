import { fetchPointHourly } from "../src/lib/andes/fetch-field";
import { generateModelMetar } from "../src/lib/andes/wmo-metar";
import { generateModelTaf } from "../src/lib/andes/wmo-taf";
import type { AndesModelId } from "../src/lib/andes/models";
import { pickHourIndex } from "../src/lib/open-meteo";

async function run(model: AndesModelId) {
  const f = await fetchPointHourly(model, -33.456, -70.546, { forecastHours: 48, pastHours: 0 });
  if (!f.ok) {
    console.log(model, "FAIL", f.error);
    return;
  }
  const i = pickHourIndex(f.runTimes);
  const metar = generateModelMetar({
    icao: "SCTB",
    elevM: 649,
    model,
    runTime: new Date().toISOString(),
    validTime: f.runTimes[i]!,
    hourly: f.hourly,
    hourIndex: i,
  });
  const taf = generateModelTaf({
    icao: "SCTB",
    elevM: 649,
    model,
    runTime: new Date().toISOString(),
    hourly: f.hourly,
  });
  console.log(`=== ${model} METAR ===\n${metar.raw}\n`);
  console.log(`=== ${model} TAF ===\n${"raw" in taf ? taf.raw : taf.error}\n`);
}

async function main() {
  for (const m of ["gfs_seamless", "ecmwf_ifs025", "icon_seamless", "gem_seamless"] as AndesModelId[]) {
    await run(m);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});