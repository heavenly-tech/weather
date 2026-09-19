import type { GrametProduct } from "@/lib/types";
import { formatTemp } from "@/lib/format";

function icing(temp: number | null, rh: number | null) {
  if (temp == null || rh == null) return false;
  return temp <= 0 && temp >= -20 && rh >= 68;
}

function windColor(kt: number | null) {
  if (kt == null) return "oklch(0.5 0.02 240)";
  if (kt >= 50) return "oklch(0.72 0.16 25)";
  if (kt >= 30) return "oklch(0.8 0.14 78)";
  return "oklch(0.78 0.08 200)";
}

export function GrametChart({ product }: { product: GrametProduct }) {
  const width = 920;
  const height = 420;
  const pad = { l: 56, r: 24, t: 28, b: 48 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const maxFl = 300;
  const cols = product.columns;
  const maxKm = Math.max(1, product.distanceKm);

  function xAt(km: number) {
    return pad.l + (km / maxKm) * innerW;
  }
  function yAt(fl: number) {
    return pad.t + innerH - (fl / maxFl) * innerH;
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[640px] w-full">
        <rect width={width} height={height} fill="oklch(0.16 0.03 250)" rx="12" />
        <text x={pad.l} y={18} fill="oklch(0.82 0.12 78)" fontSize="12" fontFamily="ui-monospace, monospace">
          {product.fromIcao} → {product.toIcao} · {product.distanceKm} km · GFS sounding
        </text>
        {[0, 50, 100, 180, 300].map((fl) => (
          <g key={fl}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={yAt(fl)}
              y2={yAt(fl)}
              stroke="oklch(0.8 0.04 230 / 18%)"
            />
            <text x={8} y={yAt(fl) + 4} fill="oklch(0.74 0.03 230)" fontSize="11" fontFamily="ui-monospace, monospace">
              FL{String(fl).padStart(3, "0")}
            </text>
          </g>
        ))}
        {cols.map((col, i) => {
          const next = cols[i + 1];
          if (!next) return null;
          return col.levels.map((level, li) => {
            const n = next.levels[li];
            if (!n) return null;
            const cloudy = ((col.cloudPct ?? 0) + (next.cloudPct ?? 0)) / 2;
            const ice = icing(level.tempC, level.rhPct) || icing(n.tempC, n.rhPct);
            const y1 = yAt(level.flApprox);
            const y2 = li + 1 < col.levels.length ? yAt(col.levels[li + 1].flApprox) : yAt(0);
            return (
              <rect
                key={`${col.km}-${level.hpa}`}
                x={xAt(col.km)}
                y={Math.min(y1, y2)}
                width={xAt(next.km) - xAt(col.km)}
                height={Math.abs(y2 - y1)}
                fill={ice ? "oklch(0.7 0.12 350 / 35%)" : `oklch(0.7 0.02 240 / ${Math.min(0.45, cloudy / 180)})`}
              />
            );
          });
        })}
        {cols.map((col) =>
          col.levels.map((level) => (
            <g key={`${col.km}-w-${level.hpa}`} transform={`translate(${xAt(col.km)}, ${yAt(level.flApprox)})`}>
              <line
                x1={0}
                y1={0}
                x2={Math.sin(((level.windDirDeg ?? 0) * Math.PI) / 180) * 12}
                y2={-Math.cos(((level.windDirDeg ?? 0) * Math.PI) / 180) * 12}
                stroke={windColor(level.windKt)}
                strokeWidth="1.4"
              />
              <text x={6} y={-6} fill="oklch(0.9 0.02 85)" fontSize="9" fontFamily="ui-monospace, monospace">
                {level.windKt ?? "—"}
              </text>
            </g>
          ))
        )}
        {cols.map((col) => (
          <g key={`lab-${col.km}`}>
            <text
              x={xAt(col.km)}
              y={height - 28}
              fill="oklch(0.82 0.12 78)"
              fontSize="11"
              fontFamily="ui-monospace, monospace"
              textAnchor="middle"
            >
              {col.label ?? `${col.km} km`}
            </text>
            <text
              x={xAt(col.km)}
              y={height - 12}
              fill="oklch(0.74 0.03 230)"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              textAnchor="middle"
            >
              {formatTemp(col.surfaceTempC)}
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-2 text-xs text-muted-foreground">
        Pink cells mark likely icing (0 to −20 °C with high humidity). Wind barbs are direction/speed in knots at each
        pressure surface. Cloud opacity follows GFS total cloud cover.
      </p>
    </div>
  );
}
