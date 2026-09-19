import { SourceBadge } from "@/components/source-badge";
import type { ProductEnvelope } from "@/lib/types";

export function ProductMeta({ envelope }: { envelope: ProductEnvelope<unknown> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SourceBadge source={envelope.source} label={envelope.sourceLabel} />
      {envelope.warning ? <span className="text-xs text-amber-200">{envelope.warning}</span> : null}
    </div>
  );
}
