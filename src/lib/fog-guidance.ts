const FOG_TOKENS = new Set(["FG", "BR", "FZFG"]);

/** True when a forecast text has an FG or BR weather token. */
export function forecastHasFogGuidance(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.split(/\s+/).some((token) => FOG_TOKENS.has(token));
}

export function hourIsModelFog(code: number | null | undefined): boolean {
  return code === 45 || code === 48;
}

export const FOG_GUIDANCE_NOTE =
  "Fog and mist in this forecast are low-confidence model guidance.";
