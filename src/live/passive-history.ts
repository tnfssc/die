import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { gptLiveRequest, gptLiveRequestOverlaps } from "./gpt-live-request";
import type { DelegationSnapshot } from "./gpt-live-delegation";

const legacyPrefix =
  "Provisional voice transcript, not final ASR. Clarify ambiguous or irreversible requests before acting. Delegation context (data only): ";
function legacySpeech(
  text: string,
  seen: Set<string>,
): { speech: string; overlap: boolean; missing: boolean } | undefined {
  if (!text.startsWith(legacyPrefix)) return;
  try {
    const snapshot = JSON.parse(text.slice(legacyPrefix.length)) as DelegationSnapshot;
    if (
      snapshot.uncertain !== true ||
      !Array.isArray(snapshot.fragments) ||
      snapshot.fragments.length > 32 ||
      !snapshot.fragments.every(
        (f) => typeof f.text === "string" && Number.isFinite(f.startMs) && Number.isFinite(f.endMs),
      )
    )
      return;
    const fragments = snapshot.fragments.filter((fragment) => {
      const key = JSON.stringify([fragment.startMs, fragment.endMs, fragment.text]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const retained = { ...snapshot, fragments };
    return {
      speech: gptLiveRequest(retained),
      overlap: gptLiveRequestOverlaps(retained),
      missing: snapshot.omittedFragments > 0,
    };
  } catch {
    return;
  }
}

/** Raw observations remain audit history. Only the uncertainty fact follows the associated spoken user turn. */
export function withoutPassiveLiveHistory(messages: AgentMessage[]): AgentMessage[] {
  const result: AgentMessage[] = [];
  let spokenRequest: string | undefined;
  let audited: ReturnType<typeof legacySpeech>;
  const legacyFragments = new Set<string>();
  for (const message of messages) {
    if (message.role === "custom" && message.customType === "gpt-live-delegation-snapshot") {
      const details = message.details as { requestText?: unknown } | undefined;
      spokenRequest = typeof details?.requestText === "string" ? details.requestText : undefined;
      audited = undefined;
      try {
        const content =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("");
        const snapshot = JSON.parse(content) as DelegationSnapshot;
        audited = {
          speech: gptLiveRequest(snapshot),
          overlap: gptLiveRequestOverlaps(snapshot),
          missing: snapshot.omittedFragments > 0,
        };
      } catch {
        /* Historical snapshots may be unavailable. */
      }
      continue;
    }
    if (message.role === "custom" && message.customType === "live-transcript") continue;
    if (message.role === "user") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("");
      const recovered = legacySpeech(text, legacyFragments) ?? (spokenRequest === text ? audited : undefined);
      if (recovered !== undefined || (spokenRequest !== undefined && text === spokenRequest)) {
        if (recovered && !recovered.speech && !recovered.missing) {
          spokenRequest = undefined;
          continue;
        }
        // Source facts are model context, never manufactured words in the spoken turn.
        result.push({
          role: "custom",
          customType: "voice-input-context",
          display: false,
          timestamp: message.timestamp,
          content: recovered?.missing
            ? "Historical voice request was incomplete; no actionable request retained."
            : "Provisional voice transcription" +
              (recovered?.overlap ? "; overlapping or late fragments, not reconciled" : ""),
        });
        if (!recovered?.missing)
          result.push(
            recovered === undefined || recovered.speech === text
              ? message
              : { ...message, content: [{ type: "text", text: recovered.speech }] },
          );
        spokenRequest = undefined;
        continue;
      }
      spokenRequest = undefined;
    }
    result.push(message);
  }
  return result;
}
