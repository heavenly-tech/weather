import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-3 py-16">
      <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Off the chart</p>
      <h1 className="font-heading text-3xl">That briefing page is not on this desk.</h1>
      <p className="text-muted-foreground">
        The Chile aviation products live on Briefing, METAR/TAF, GRAMET, GAMET, WRF point, Synoptic, and 3D field.
      </p>
      <Link className={buttonVariants()} href="/?icao=SCEL">
        Back to SCEL briefing
      </Link>
    </div>
  );
}
