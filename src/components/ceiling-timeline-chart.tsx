"use client";

import type { ModelCeilingSeries, ObservedCeilingSeries } from "@/lib/andes/timeline";
import { categoryColor } from "@/lib/andes/ceiling-style";

const W = 640;
const H = 200;
const PAD = 32;

export function CeilingTimelineChart({
  observation,
  models,
  title,
}: {
  observation: ObservedCeilingSeries | null;
  models: ModelCeilingSeries[];
  title: string;
}) {
  const all = [
    ...(observation?.points ?? []),
    ...models.flatMap((m) => m.points),
  ];
  const maxFt = Math.max(5000, ...all.map((p) => p.ceilingFtAgl ?? 5000));
  const minT = Math.min(...all.map((p) => new Date(p.time).getTime()), Date.now());
  const maxT = Math.max(...all.map((p) => new Date(p.time).getTime()), Date.now() + 1);

  function x(t: string) {
    return PAD + ((new Date(t).getTime() - minT) / (maxT - minT)) * (W - PAD * 2);
  }
  function y(ft: number | null) {
    const v = ft ?? maxFt;
    return H - PAD - (v / maxFt) * (H - PAD * 2);
  }

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
      <p className="mb-2 text-sm font-medium">{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-full">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#475569" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#475569" />
        {models.map((series, idx) => {
          if (!series.points.length) return null;
          const d = series.points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.time)} ${y(p.ceilingFtAgl)}`)
            .join(" ");
          const colors = ["#38bdf8", "#a78bfa", "#34d399", "#f472b6"];
          return (
            <g key={series.model}>
              <path d={d} fill="none" stroke={colors[idx % colors.length]} strokeWidth={1.5} />
              {series.unavailable ? (
                <text x={PAD} y={PAD + idx * 14} fill="#94a3b8" fontSize="10">
                  {series.label}: unavailable
                </text>
              ) : null}
            </g>
          );
        })}
        {observation?.points.map((p, i) => (
          <circle
            key={`${p.time}-${i}`}
            cx={x(p.time)}
            cy={y(p.ceilingFtAgl)}
            r={3}
            fill={categoryColor(p.category as "VFR")}
          />
        ))}
      </svg>
      {observation ? (
        <p className="mt-1 text-xs text-muted-foreground">{observation.label}</p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No METAR ceiling series</p>
      )}
    </div>
  );
}