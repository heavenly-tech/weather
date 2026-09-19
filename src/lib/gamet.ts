import { fetchJson, nowIso } from "./http";
import { inChileBbox } from "./geo";
import { mockGamet } from "./mocks";
import { FIRS, chileStations } from "./stations";
import type { AwcSigmet } from "./awc";
import type { ChileFirId, GametBulletin, ProductEnvelope } from "./types";
import { formatWind, formatTemp } from "./format";
import { fetchOpenMeteo, asSingle, extractLevels, openMeteoPressureUrl, pickHourIndex, surfaceSnapshot } from "./open-meteo";

const FIR_BOX: Record<ChileFirId, { minLat: number; maxLat: number }> = {
  ANTOFAGASTA: { minLat: -27.5, maxLat: -17 },
  SANTIAGO: { minLat: -38.5, maxLat: -27.5 },
  PUERTO_MONTT: { minLat: -56.5, maxLat: -38.5 },
};

function inFir(fir: ChileFirId, lat: number) {
  const box = FIR_BOX[fir];
  return lat >= box.minLat && lat <= box.maxLat;
}

function zuluRange(from: Date, to: Date): string {
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${fmt(from)}/${fmt(to)}`;
}

export async function buildGamet(firId: ChileFirId): Promise<ProductEnvelope<GametBulletin>> {
  const fir = FIRS.find((f) => f.id === firId) ?? FIRS[1];
  const stations = chileStations().filter((s) => s.fir === fir.id);
  const representative = stations[Math.floor(stations.length / 2)] ?? stations[0];

  const [sigmetResult, modelResult] = await Promise.all([
    fetchJson<AwcSigmet[]>("https://aviationweather.gov/api/data/isigmet?format=json"),
    representative
      ? fetchOpenMeteo(openMeteoPressureUrl(representative.lat, representative.lon))
      : Promise.resolve({ ok: false as const, status: 0, error: "No station" }),
  ]);

  const sigmets = (sigmetResult.ok ? sigmetResult.data : []).filter((s) => {
    if ((s.firId ?? "").startsWith("SC") || (s.icaoId ?? "").startsWith("SC")) return true;
    const coords = s.coords ?? [];
    return coords.some((c) => inChileBbox(c.lat, c.lon) && inFir(fir.id, c.lat));
  });

  if (!modelResult.ok) {
    const mock = mockGamet(fir.label);
    return {
      data: {
        ...mock,
        fir: fir.id,
        firLabel: fir.label,
        sigmets: sigmets.map((s) => ({ raw: s.rawSigmet ?? "", hazard: s.hazard ?? null })),
      },
      source: "mock",
      sourceLabel: "Mock GAMET (model circuit down)",
      fetchedAt: nowIso(),
      warning: `Could not build a live-derived GAMET: ${modelResult.error}`,
    };
  }

  const response = asSingle(modelResult.data);
  const hourly = response.hourly ?? {};
  const times = (hourly.time ?? []) as string[];
  const index = pickHourIndex(times);
  const snap = surfaceSnapshot(hourly, index);
  const levels = extractLevels(hourly, index);
  const fl050 = levels.find((l) => l.hpa === 850);
  const fl100 = levels.find((l) => l.hpa === 700);
  const fl180 = levels.find((l) => l.hpa === 500);
  const freeze = levels.find((l) => (l.tempC ?? 99) <= 0);

  const validFrom = new Date();
  validFrom.setUTCMinutes(0, 0, 0);
  const validTo = new Date(validFrom.getTime() + 6 * 3600_000);

  const icing =
    levels.some((l) => l.tempC != null && l.tempC <= 0 && l.tempC >= -20 && (l.rhPct ?? 0) >= 70)
      ? "ICE: MOD possible in cloud near FZLVL"
      : "ICE: NIL significant";
  const turb =
    (fl180?.windKt ?? 0) - (fl050?.windKt ?? 0) > 35
      ? "TURB: MOD possible ABV FL100 with speed shear"
      : "TURB: NIL significant";
  const vis =
    (snap.visKm ?? 10) < 5 ? `SFC VIS: ${snap.visKm} KM` : "SFC VIS: 10KM OR MORE";
  const cloud =
    (snap.cloudPct ?? 0) >= 75
      ? "SIG CLOUD: BKN/OVC"
      : (snap.cloudPct ?? 0) >= 40
        ? "SIG CLOUD: SCT/BKN"
        : "SIG CLOUD: FEW/SCT";

  const sigmetLines = sigmets.length
    ? sigmets.map((s) => s.rawSigmet ?? `${s.hazard ?? "HAZARD"}`)
    : ["SIGMET: NIL current international SIGMET intersecting this FIR"];

  const sectionI = [
    `SFC WIND: ${formatWind(snap.windDirDeg, snap.windKt)}`,
    vis,
    cloud,
    icing,
    turb,
    ...sigmetLines,
  ];
  const sectionII = [
    `PSYS: GFS-derived field for ${fir.label} (not an official DMC analysis)`,
    `WIND/T FL050: ${formatWind(fl050?.windDirDeg ?? null, fl050?.windKt ?? null)} ${formatTemp(fl050?.tempC ?? null)}`,
    `WIND/T FL100: ${formatWind(fl100?.windDirDeg ?? null, fl100?.windKt ?? null)} ${formatTemp(fl100?.tempC ?? null)}`,
    `WIND/T FL180: ${formatWind(fl180?.windDirDeg ?? null, fl180?.windKt ?? null)} ${formatTemp(fl180?.tempC ?? null)}`,
    `FZLVL: ${freeze ? `near FL${String(freeze.flApprox).padStart(3, "0")}` : "ABV FL180"}`,
    `CLD: ${Math.round(snap.cloudPct ?? 0)}% cover in the model grid`,
  ];

  const raw = `${fir.label.toUpperCase()} GAMET VALID ${zuluRange(validFrom, validTo)} ${fir.icaoHint}-
SECN I
${sectionI.join("\n")}
SECN II
${sectionII.join("\n")}
=
`;

  const bulletin: GametBulletin = {
    fir: fir.id,
    firLabel: fir.label,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
    raw,
    sigmets: sigmets.map((s) => ({ raw: s.rawSigmet ?? "", hazard: s.hazard ?? null })),
    sections: [
      { title: "Section I — hazards for low-level flight", lines: sectionI },
      { title: "Section II — additional information", lines: sectionII },
    ],
  };

  return {
    data: bulletin,
    source: "derived",
    sourceLabel: "Derived GAMET-style bulletin (GFS + AWC SIGMETs). Official DGAC GAMET stays on OPMET.",
    fetchedAt: nowIso(),
    warning: sigmetResult.ok
      ? undefined
      : `SIGMET circuit unavailable (${sigmetResult.error}). Hazards section has no live SIGMETs.`,
  };
}

export function parseFir(value: string | null): ChileFirId {
  const v = (value ?? "SANTIAGO").toUpperCase();
  if (v === "ANTOFAGASTA" || v === "SANTIAGO" || v === "PUERTO_MONTT") return v;
  return "SANTIAGO";
}
