import { parseUtcIso } from "@/lib/andes/parse-utc";

const STAMP = "MODEL OUTPUT — NOT OFFICIAL";

function ddhhToMs(ddhh: string, anchor: Date): number {
  const day = Number(ddhh.slice(0, 2));
  const hour = Number(ddhh.slice(2, 4));
  const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), day, hour));
  if (d.getTime() < anchor.getTime() - 20 * 86400000) d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime();
}

export function assertModelTafFormat(
  raw: string
): { ok: true; warnings: string[] } | { ok: false; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (!raw.startsWith(STAMP)) reasons.push("stamp must be first line");

  const body = raw.split("\n").slice(1).join(" ").trim();

  const header = body.match(/^TAF\s+([A-Z]{4})\s+(\d{6})Z\s+(\d{4})\/(\d{4})/);
  if (!header) reasons.push("TAF header / validity (DDHHMMZ issue; DDHH/DDHH validity)");

  const issueIso = header?.[2];
  const anchor = issueIso ? parseUtcIso(`2026-01-${issueIso.slice(0, 2)}T${issueIso.slice(2, 4)}:00:00Z`) : new Date();
  const validFrom = header?.[3];
  const validTo = header?.[4];

  const groups = [...body.matchAll(/\b(BECMG|TEMPO|PROB30|PROB40)\s+(\d{4})(\/(\d{4}))?/g)];
  for (const g of groups) {
    const tag = g[1]!;
    const from = g[2]!;
    const slashTo = g[4];
    if ((tag === "BECMG" || tag === "TEMPO" || tag.startsWith("PROB")) && !slashTo) {
      reasons.push(`${tag} must use DDhh/DDhh window`);
    }
    const toGroup = slashTo ?? from;
    if (slashTo && from === toGroup) {
      reasons.push(`${tag} zero-length window ${from}/${toGroup}`);
    }
    if (validFrom && validTo) {
      const vf = ddhhToMs(validFrom, anchor);
      const vt = ddhhToMs(validTo, anchor);
      const gf = ddhhToMs(from, anchor);
      const gt = ddhhToMs(toGroup, anchor);
      if (gf < vf || gt > vt) {
        reasons.push(`change group ${tag} ${from}/${toGroup} outside validity ${validFrom}/${validTo}`);
      }
    }
    if (tag === "BECMG" && slashTo) {
      const hours = (ddhhToMs(toGroup, anchor) - ddhhToMs(from, anchor)) / 3_600_000;
      if (hours > 4) reasons.push(`BECMG ${from}/${toGroup} is ${hours} h (never over 4 h)`);
      else if (hours > 2) warnings.push(`BECMG ${from}/${toGroup} is ${hours} h (normally 2 h or less)`);
    }
  }

  const becmgCount = (body.match(/\bBECMG\b/g) ?? []).length;
  if (becmgCount > 6) reasons.push(`too many BECMG groups (${becmgCount})`);

  return reasons.length ? { ok: false, reasons, warnings } : { ok: true, warnings };
}