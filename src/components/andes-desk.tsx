"use client";

import { useCallback, useEffect, useState } from "react";
import { AndesControls, type AndesControlsState } from "@/components/andes-controls";
import { AndesScene } from "@/components/andes-scene";
import { CeilingLegend } from "@/components/ceiling-legend";
import { CeilingTimelineChart } from "@/components/ceiling-timeline-chart";
import { CoherencePanels, type CoherencePayload } from "@/components/coherence-panels";
import { ModelOutputStamp } from "@/components/model-output-stamp";
import { TIMELINE_AIRFIELDS } from "@/lib/andes/domain";
import type { CeilingCell } from "@/lib/andes/fetch-field";
import type { ModelCeilingSeries, ObservedCeilingSeries } from "@/lib/andes/timeline";

export function AndesDesk() {
  const [state, setState] = useState<AndesControlsState>({
    model: "gfs_seamless",
    timeIndex: 0,
    validIso: "",
    altitudeFt: 10000,
    pressureHpa: 700,
  });
  const [timeLabels, setTimeLabels] = useState<string[]>([]);
  const [modelAvailability, setModelAvailability] = useState<Record<string, boolean>>({});
  const [cells, setCells] = useState<CeilingCell[]>([]);
  const [sliceValues, setSliceValues] = useState<{ lat: number; lon: number; tempC: number | null; cloudPct: number | null }[]>([]);
  const [timelines, setTimelines] = useState<
    Record<string, { observation: ObservedCeilingSeries | null; models: ModelCeilingSeries[]; label?: string }>
  >({});
  const [coherence, setCoherence] = useState<CoherencePayload | null>(null);
  const [generatedMetar, setGeneratedMetar] = useState<string | null>(null);
  const [generatedTaf, setGeneratedTaf] = useState<string | null>(null);
  const [visEstimated, setVisEstimated] = useState(false);
  const [cldEstimated, setCldEstimated] = useState(false);
  const [midCloudBaseUnk, setMidCloudBaseUnk] = useState(false);
  const [gridWarning, setGridWarning] = useState<string | null>(null);
  const [gridShape, setGridShape] = useState({ rows: 44, cols: 32 });
  const [sliceHeightM, setSliceHeightM] = useState<number | null>(null);

  const patch = useCallback((p: Partial<AndesControlsState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  useEffect(() => {
    fetch("/api/andes/models")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, boolean> = {};
        (d.models ?? []).forEach((m: { id: string; available: boolean }) => {
          map[m.id] = m.available;
        });
        setModelAvailability(map);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams({
      model: state.model,
      ...(state.validIso ? { validTime: state.validIso } : {}),
    });
    fetch(`/api/andes/ceiling?${q}`)
      .then((r) => r.json())
      .then((d) => {
        setCells(d.cells ?? []);
        if (d.gridShape) setGridShape(d.gridShape);
        setGridWarning(d.unavailable ?? null);
        if (d.modelRun && !state.validIso) patch({ validIso: d.modelRun });
      })
      .catch(() => setGridWarning("Ceiling grid fetch failed"));
  }, [state.model, state.validIso, patch]);

  useEffect(() => {
    const q = new URLSearchParams({
      model: state.model,
      hpa: String(state.pressureHpa),
      ...(state.validIso ? { validTime: state.validIso } : {}),
    });
    fetch(`/api/andes/slice?${q}`)
      .then((r) => r.json())
      .then((d) => {
        setSliceValues(d.values ?? []);
        setSliceHeightM(d.sliceHeightM ?? null);
      })
      .catch(() => undefined);
  }, [state.model, state.pressureHpa, state.validIso]);

  useEffect(() => {
    fetch(`/api/andes/times?model=${encodeURIComponent(state.model)}`)
      .then((r) => r.json())
      .then((d) => setTimeLabels(d.times ?? []))
      .catch(() => setTimeLabels([]));
  }, [state.model]);

  useEffect(() => {
    TIMELINE_AIRFIELDS.forEach((icao) => {
      fetch(`/api/andes/timeline?icao=${icao}`)
        .then((r) => r.json())
        .then((d) => {
          setTimelines((prev) => ({
            ...prev,
            [icao]: {
              observation: d.observation,
              models: d.models,
              label: d.obsProxyLabel,
            },
          }));
        })
        .catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    fetch(`/api/andes/coherence?icao=SCEL&model=${state.model}`)
      .then((r) => r.json())
      .then(setCoherence)
      .catch(() => setCoherence(null));
  }, [state.model]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/generated/metar?icao=SCTB&model=${state.model}`).then((r) => r.json()),
      fetch(`/api/generated/metar?icao=SCVH&model=${state.model}`).then((r) => r.json()),
      fetch(`/api/generated/taf?icao=SCTB&model=${state.model}`).then((r) => r.json()),
    ]).then(([m, mVh, t]) => {
      setGeneratedMetar(
        [m.raw, mVh.raw].filter(Boolean).join("\n\n---\n\n") || null
      );
      setGeneratedTaf(t.raw ?? null);
      setVisEstimated(Boolean(m.visEstimated || t.visEstimated));
      setCldEstimated(Boolean(m.cldEstimated || t.cldEstimated));
      setMidCloudBaseUnk(Boolean(m.midCloudBaseUnk || t.midCloudBaseUnk));
    });
  }, [state.model]);

  return (
    <div className="space-y-6">
      <ModelOutputStamp className="mb-3 w-full text-center" />
      <p className="mb-2 text-xs text-muted-foreground">
        Model fields via{" "}
        <a href="https://open-meteo.com/" className="underline" rel="noopener noreferrer">
          Open-Meteo
        </a>{" "}
        (CC BY 4.0). Free tier is non-commercial; production needs a paid plan or self-hosted Open-Meteo.
      </p>
      <div>
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Aguacero-style · Step 1</p>
        <h1 className="mt-1 font-heading text-3xl">Central Chile ceiling viewer</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Domain 32.1–34.8°S, 71.8–70.0°W centred on SCTB (Tobalaba). Headline product: ceiling in ft AGL over
          Andes terrain with mountain-obscuration shading. Models: GFS, ECMWF IFS 0.25°, ICON, GEM via Open-Meteo.
        </p>
      </div>

      <CeilingLegend />
      <AndesControls
        state={state}
        timeLabels={timeLabels}
        modelAvailability={modelAvailability}
        onChange={patch}
      />
      {gridWarning ? <p className="text-sm text-amber-400">Model layer: {gridWarning}</p> : null}
      <AndesScene
        ceilingCells={cells}
        sliceValues={sliceValues}
        showSlice
        pressureHpa={state.pressureHpa}
        gridRows={gridShape.rows}
        gridCols={gridShape.cols}
        sliceHeightM={sliceHeightM}
      />

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Per-airfield ceiling timelines</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {TIMELINE_AIRFIELDS.map((icao) => {
            const row = timelines[icao];
            const title =
              icao === "SCTB"
                ? "SCTB (proxy obs: SCEL METAR)"
                : icao === "SCVH"
                  ? row?.label ?? "SCVH (nearest METAR)"
                  : icao;
            return (
              <CeilingTimelineChart
                key={icao}
                title={title}
                observation={row?.observation ?? null}
                models={row?.models ?? []}
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">METAR / TAF coherence</h2>
        <CoherencePanels data={coherence} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Generated METAR (SCTB + SCVH)</h3>
            <div className="flex items-center gap-2">
              {visEstimated ? (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  VIS EST
                </span>
              ) : null}
              {cldEstimated ? (
                <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800 dark:text-sky-300">
                  CLD EST
                </span>
              ) : null}
              {midCloudBaseUnk ? (
                <span
                  className="rounded bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-900 dark:text-violet-300"
                  title="Cloud base not resolved; NSC uses AIP MSA where published"
                >
                  MID CLD BASE UNK
                </span>
              ) : null}
              <ModelOutputStamp />
            </div>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs">{generatedMetar ?? "Loading…"}</pre>
        </div>
        <div className="rounded-xl border border-border/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Generated TAF (SCTB)</h3>
            <div className="flex items-center gap-2">
              {visEstimated ? (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  VIS EST
                </span>
              ) : null}
              {cldEstimated ? (
                <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800 dark:text-sky-300">
                  CLD EST
                </span>
              ) : null}
              {midCloudBaseUnk ? (
                <span
                  className="rounded bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-900 dark:text-violet-300"
                  title="Cloud base not resolved; NSC uses AIP MSA where published"
                >
                  MID CLD BASE UNK
                </span>
              ) : null}
              <ModelOutputStamp />
            </div>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            NSC gating uses AIP Chile MSA for SCTB, SCEL, and SCVM. SCVH and SCPD have no
            published MSA; those two stay labelled assumptions in{" "}
            <code className="text-[10px]">airfield-msa.ts</code>.
          </p>
          <pre className="whitespace-pre-wrap font-mono text-xs">{generatedTaf ?? "Loading…"}</pre>
        </div>
      </section>
    </div>
  );
}