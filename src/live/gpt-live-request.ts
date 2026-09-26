import type { DelegationSnapshot } from "./gpt-live-delegation";

export function gptLiveRequestOverlaps(snapshot: DelegationSnapshot): boolean {
  let latestEnd = snapshot.priorSpeechEndMs ?? -1;
  let overlap = false;
  for (const fragment of snapshot.fragments) {
    if (fragment.startMs < latestEnd) overlap = true;
    latestEnd = Math.max(latestEnd, fragment.endMs);
  }
  return overlap;
}

/** Speech only. Never manufacture user prose or silently dispatch a retained suffix. */
export function gptLiveRequest(snapshot: DelegationSnapshot): string {
  if (snapshot.omittedFragments > 0) return "";
  return snapshot.fragments
    .map((fragment) => fragment.text)
    .join(gptLiveRequestOverlaps(snapshot) ? "\n" : "")
    .trim();
}
