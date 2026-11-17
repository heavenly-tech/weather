const STAMP = "MODEL OUTPUT — NOT OFFICIAL";

export function assertModelTafFormat(raw: string): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (!raw.includes(STAMP)) reasons.push("missing MODEL OUTPUT stamp");

  const header = raw.match(/^TAF\s+([A-Z]{4})\s+(\d{4})Z\s+(\d{4})\/(\d{4})/);
  if (!header) reasons.push("TAF header / validity group");

  const validFrom = header?.[3];
  const validTo = header?.[4];

  const changeGroups = [...raw.matchAll(/\b(BECMG|TEMPO|PROB30|PROB40)\s+(\d{4})\/(\d{4})/g)];
  for (const g of changeGroups) {
    const from = g[2]!;
    const to = g[3]!;
    if (validFrom && validTo) {
      if (from < validFrom || to > validTo) {
        reasons.push(`change group ${g[1]} ${from}/${to} outside validity ${validFrom}/${validTo}`);
      }
    }
  }

  if (!/\bBECMG\b/.test(raw) && !/\bTEMPO\b/.test(raw)) {
    reasons.push("expected at least one BECMG or TEMPO group");
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}