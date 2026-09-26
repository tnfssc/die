import type { DelegationSnapshot } from "./gpt-live-delegation";

/** Speech only; protocol evidence stays in internal history. Overlap is not a final-ASR replacement rule. */
export function gptLiveRequest(snapshot: DelegationSnapshot): string {
  let latestEnd = -1;
  let overlap = false;
  for (const fragment of snapshot.fragments) {
    if (fragment.startMs < latestEnd) overlap = true;
    latestEnd = Math.max(latestEnd, fragment.endMs);
  }
  const full = snapshot.fragments.map((fragment) => fragment.text).join(overlap ? "\n" : "");
  const speech = full.slice(-4096).trim();
  if (!speech) return "";
  const missing = snapshot.omittedFragments || full.length > 4096;
  return (
    (missing ? "Earlier speech was not retained; this is the captured portion:\n" : "") +
    (overlap ? "Overlapping provisional voice fragments:\n" : "") +
    speech
  );
}
