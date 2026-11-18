"use client";

import { FogGuidanceNote } from "@/components/fog-guidance-note";
import { ModelOutputStamp } from "@/components/model-output-stamp";
import { forecastHasFogGuidance } from "@/lib/fog-guidance";

export type CoherencePayload = {
  views: {
    modelVsMetar: {
      modelCeilingFt: number | null;
      metarCeilingFt: number | null;
      modelVsMetar: string;
    };
    modelTafVsOfficial: { model: string; official: string };
    officialTafVsMetar: { taf: string; metar: string };
  };
};

export function CoherencePanels({ data }: { data: CoherencePayload | null }) {
  if (!data) {
    return <p className="text-sm text-muted-foreground">Load coherence data from the API…</p>;
  }
  const { modelVsMetar, modelTafVsOfficial, officialTafVsMetar } = data.views;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-xl border border-border/60 p-4">
        <h3 className="text-sm font-medium">(a) Model vs METAR ceiling</h3>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Model</dt>
            <dd>{modelVsMetar.modelCeilingFt?.toFixed(0) ?? "—"} ft</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">METAR</dt>
            <dd>{modelVsMetar.metarCeilingFt?.toFixed(0) ?? "—"} ft</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Delta band</dt>
            <dd className="capitalize">{modelVsMetar.modelVsMetar}</dd>
          </div>
        </dl>
      </section>
      <section className="rounded-xl border border-border/60 p-4">
        <h3 className="text-sm font-medium">(b) Model TAF-style vs official TAF</h3>
        <ModelOutputStamp className="mb-2" />
        {forecastHasFogGuidance(modelTafVsOfficial.model) ? (
          <div className="mb-2">
            <FogGuidanceNote />
          </div>
        ) : null}
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
          {modelTafVsOfficial.model}
        </pre>
        <p className="mt-2 text-[10px] text-muted-foreground">Official:</p>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px]">{modelTafVsOfficial.official}</pre>
      </section>
      <section className="rounded-xl border border-border/60 p-4">
        <h3 className="text-sm font-medium">(c) Official TAF vs METAR</h3>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
          {officialTafVsMetar.taf}
        </pre>
        <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px]">{officialTafVsMetar.metar}</pre>
      </section>
    </div>
  );
}