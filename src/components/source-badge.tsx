import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SourceKind } from "@/lib/types";

const LABELS: Record<SourceKind, string> = {
  live: "Live",
  fallback: "Fallback",
  derived: "Derived",
  mock: "Mock",
};

export function SourceBadge({
  source,
  label,
}: {
  source: SourceKind;
  label?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono uppercase tracking-wider",
        source === "live" && "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
        source === "fallback" && "border-sky-400/40 bg-sky-500/10 text-sky-200",
        source === "derived" && "border-amber-400/40 bg-amber-500/10 text-amber-200",
        source === "mock" && "border-rose-400/40 bg-rose-500/10 text-rose-200"
      )}
    >
      {LABELS[source]}
      {label ? <span className="normal-case tracking-normal text-[11px] opacity-80">· {label}</span> : null}
    </Badge>
  );
}
