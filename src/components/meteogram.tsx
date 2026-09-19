import type { PointForecast } from "@/lib/types";
import { formatTemp, weatherCodeLabel } from "@/lib/format";

export function Meteogram({ forecast }: { forecast: PointForecast }) {
  const hours = forecast.hours.slice(0, 48);
  const width = 920;
  const height = 280;
  const pad = { l: 44, r: 16, t: 20, b: 36 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const temps = hours.map((h) => h.tempC).filter((n): n is number => n != null);
  const minT = Math.min(...temps, 0) - 2;
  const maxT = Math.max(...temps, 20) + 2;
  const maxP = Math.max(1, ...hours.map((h) => h.precipMm ?? 0));

  function x(i: number) {
    return pad.l + (i / Math.max(1, hours.length - 1)) * innerW;
  }
  function yTemp(t: number) {
    return pad.t + innerH - ((t - minT) / (maxT - minT)) * innerH;
  }

  const path = hours
    .map((h, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${yTemp(h.tempC ?? minT)}`)
    .join(" ");

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[640px] w-full">
        <rect width={width} height={height} rx="12" fill="oklch(0.16 0.03 250)" />
        <text x={pad.l} y={14} fill="oklch(0.82 0.12 78)" fontSize="12" fontFamily="ui-monospace, monospace">
          {forecast.model} · {forecast.icao}
        </text>
        {hours.map((h, i) => {
          const precip = h.precipMm ?? 0;
          if (precip <= 0) return null;
          const barH = (precip / maxP) * innerH * 0.45;
          return (
            <rect
              key={`p-${h.time}`}
              x={x(i) - 4}
              y={pad.t + innerH - barH}
              width={8}
              height={barH}
              fill="oklch(0.72 0.1 210 / 55%)"
            />
          );
        })}
        <path d={path} fill="none" stroke="oklch(0.82 0.12 78)" strokeWidth="1.8" />
        {hours.map((h, i) =>
          i % 6 === 0 ? (
            <text
              key={`t-${h.time}`}
              x={x(i)}
              y={height - 12}
              textAnchor="middle"
              fill="oklch(0.74 0.03 230)"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
            >
              {new Date(h.time).toISOString().slice(11, 16)}Z
            </text>
          ) : null
        )}
      </svg>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {hours.filter((_, i) => i % 6 === 0).slice(0, 8).map((h) => (
          <div key={h.time} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
            <p className="font-mono text-primary">{new Date(h.time).toISOString().slice(0, 16).replace("T", " ")}Z</p>
            <p>
              {formatTemp(h.tempC)} · {h.windKt ?? "—"} kt · {weatherCodeLabel(h.weatherCode)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
