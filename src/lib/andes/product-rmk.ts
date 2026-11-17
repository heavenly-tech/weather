/** EST tokens (VIS EST, CLD EST, …) must appear only in trailing RMK, never in the wx body. */

const EST_TOKEN = /\b(?:VIS|CLD)\s+EST\b/;

export function assertEstOnlyInTrailingRmk(raw: string): void {
  const withoutStamp = raw.replace(/^MODEL OUTPUT — NOT OFFICIAL\n/, "");
  const rmkIdx = withoutStamp.indexOf(" RMK ");
  const beforeRmk = rmkIdx >= 0 ? withoutStamp.slice(0, rmkIdx) : withoutStamp;
  if (EST_TOKEN.test(beforeRmk)) {
    throw new Error(`EST token must not appear before RMK: ${beforeRmk.slice(0, 120)}…`);
  }
}