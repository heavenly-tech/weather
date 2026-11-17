import { CEILING_LEGEND } from "@/lib/andes/ceiling";

export function CeilingLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Ceiling category (ft AGL; visibility when model provides it)</span>
      {(Object.keys(CEILING_LEGEND) as (keyof typeof CEILING_LEGEND)[]).map((key) => {
        const row = CEILING_LEGEND[key];
        const range =
          "maxFtAgl" in row && "minFtAgl" in row
            ? `${row.minFtAgl}–${row.maxFtAgl}`
            : "minFtAgl" in row
              ? `>${row.minFtAgl}`
              : `<${row.maxFtAgl! + 1}`;
        return (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: row.color }} />
            {row.label} ({range} ft)
          </span>
        );
      })}
    </div>
  );
}