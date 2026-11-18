"use client";

import { ftMslToHpa, hpaToFtMsl, nearestPressureLevel } from "@/lib/andes/altitude";
import type { AndesModelId } from "@/lib/andes/models";
import { ANDES_MODELS } from "@/lib/andes/models";

export type AndesControlsState = {
  model: AndesModelId;
  timeIndex: number;
  validIso: string;
  altitudeFt: number;
  pressureHpa: number;
};

export function AndesControls({
  state,
  timeLabels,
  modelAvailability,
  onChange,
}: {
  state: AndesControlsState;
  timeLabels: string[];
  modelAvailability: Record<string, boolean | undefined>;
  onChange: (patch: Partial<AndesControlsState>) => void;
}) {
  return (
    <div className="grid gap-4 rounded-xl border border-border/60 bg-muted/20 p-4 lg:grid-cols-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Model</label>
        <select
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={state.model}
          onChange={(e) => onChange({ model: e.target.value as AndesModelId })}
        >
          {ANDES_MODELS.map((m) => (
            <option key={m.id} value={m.id} disabled={modelAvailability[m.id] === false}>
              {m.label}
              {modelAvailability[m.id] === false
                ? m.id === "wrf_local"
                  ? " (no run available yet)"
                  : " (unavailable)"
                : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Valid time ({state.validIso ? new Date(state.validIso).toUTCString().slice(0, 22) : "—"})
        </label>
        <input
          type="range"
          min={0}
          max={Math.max(0, timeLabels.length - 1)}
          value={state.timeIndex}
          className="mt-2 w-full"
          onChange={(e) => {
            const timeIndex = Number(e.target.value);
            onChange({ timeIndex, validIso: timeLabels[timeIndex] ?? state.validIso });
          }}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Altitude slice</label>
        <div className="mt-1 flex gap-2">
          <input
            type="number"
            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={state.altitudeFt}
            onChange={(e) => {
              const altitudeFt = Number(e.target.value);
              onChange({ altitudeFt, pressureHpa: nearestPressureLevel(ftMslToHpa(altitudeFt)) });
            }}
          />
          <span className="self-center text-xs text-muted-foreground">ft MSL</span>
          <input
            type="number"
            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={state.pressureHpa}
            onChange={(e) => {
              const pressureHpa = nearestPressureLevel(Number(e.target.value));
              onChange({ pressureHpa, altitudeFt: hpaToFtMsl(pressureHpa) });
            }}
          />
          <span className="self-center text-xs text-muted-foreground">hPa</span>
        </div>
      </div>
    </div>
  );
}