import { SynopticDesk } from "@/components/synoptic-desk";
import { loadSynoptic } from "@/lib/products";

export const dynamic = "force-dynamic";

export default function SynopticPage() {
  return <SynopticDesk envelope={loadSynoptic()} />;
}
