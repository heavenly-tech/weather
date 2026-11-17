const STAMP = "MODEL OUTPUT — NOT OFFICIAL";

export function assertModelTafFormat(raw: string): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (!raw.startsWith(STAMP)) reasons.push("stamp must be first line");

  const body = raw.split("\n").slice(1).join(" ").trim();

  const header = body.match(/^TAF\s+([A-Z]{4})\s+(\d{6})Z\s+(\d{4})\/(\d{4})/);
  if (!header) reasons.push("TAF header / validity (DDHHMMZ issue; DDHH/DDHH validity)");

  const validFrom = header?.[3];
  const validTo = header?.[4];

  const changeGroups = [...body.matchAll(/\b(BECMG|TEMPO|PROB30|PROB40)\s+(\d{4})(?:\/(\d{4}))?/g)];
  for (const g of changeGroups) {
    const from = g[2]!;
    const to = g[3] ?? from;
    if (validFrom && validTo) {
      if (from < validFrom || to > validTo) {
        reasons.push(`change group ${g[1]} ${from}/${to} outside validity ${validFrom}/${validTo}`);
      }
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}