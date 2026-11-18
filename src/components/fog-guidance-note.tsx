import { FOG_GUIDANCE_NOTE } from "@/lib/fog-guidance";

export function FogGuidanceNote() {
  return (
    <p className="text-[11px] leading-snug text-amber-900 dark:text-amber-200">
      <span className="mr-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-medium uppercase tracking-wide">
        Low confidence
      </span>
      {FOG_GUIDANCE_NOTE}
    </p>
  );
}
