import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function OfficialDgacBadge({
  stale,
  unavailable,
}: {
  stale?: boolean;
  unavailable?: boolean;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono uppercase tracking-wider",
        unavailable
          ? "border-amber-400/50 bg-amber-500/10 text-amber-100"
          : stale
            ? "border-amber-400/50 bg-amber-500/10 text-amber-100"
            : "border-sky-400/50 bg-sky-500/15 text-sky-100"
      )}
    >
      Oficial DGAC
      {unavailable ? " · unavailable" : stale ? " · stale" : null}
    </Badge>
  );
}