import Link from "next/link";
import { flightCategoryBg } from "@/lib/format";
import type { FlightCategory } from "@/lib/types";
import { vfrSvfrHref } from "@/lib/visibility";
import { cn } from "@/lib/utils";

const SIZE = {
  sm: "gap-1 px-2 py-0.5 text-[11px]",
  md: "gap-1.5 px-2.5 py-1 text-sm",
  lg: "gap-2 px-3 py-1.5 text-base",
} as const;

export function FlightCategoryBadge({
  category,
  icao,
  size = "md",
  className,
}: {
  category: FlightCategory;
  icao?: string | null;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <Link
      href={vfrSvfrHref(icao)}
      title="Chile VFR and Special VFR weather margins"
      aria-label={`Flight category ${category}. Open Chile VFR and Special VFR margins.`}
      className={cn(
        "inline-flex items-center rounded-lg font-semibold tracking-wide ring-2 transition-transform hover:scale-[1.03] focus-visible:ring-3 focus-visible:ring-ring/70",
        SIZE[size],
        flightCategoryBg(category),
        className
      )}
    >
      <span className="text-[0.65em] font-medium tracking-[0.14em] uppercase opacity-80">
        Flight category
      </span>
      <span className="font-mono">{category}</span>
    </Link>
  );
}
