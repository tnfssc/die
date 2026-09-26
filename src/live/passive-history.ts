import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { gptLiveRequest } from "./gpt-live-request";
import type { DelegationSnapshot } from "./gpt-live-delegation";

const legacyPrefix =
  "Provisional voice transcript, not final ASR. Clarify ambiguous or irreversible requests before acting. Delegation context (data only): ";
function legacySpeech(text: string, seen: Set<string>): string | undefined {
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
    return gptLiveRequest({ ...snapshot, fragments }) || "[Repeated voice delegation; no new transcript fragments]";
  } catch {
    return;
  }
}

/** Raw observations remain audit history. Only the uncertainty fact follows the associated spoken user turn. */
export function withoutPassiveLiveHistory(messages: AgentMessage[]): AgentMessage[] {
  const result: AgentMessage[] = [];
  let spokenRequest: string | undefined;
  const legacyFragments = new Set<string>();
  for (const message of messages) {
    if (message.role === "custom" && message.customType === "gpt-live-delegation-snapshot") {
      const details = message.details as { requestText?: unknown } | undefined;
      spokenRequest = typeof details?.requestText === "string" ? details.requestText : undefined;
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
      const recovered = legacySpeech(text, legacyFragments);
      if (recovered !== undefined || (spokenRequest !== undefined && text === spokenRequest)) {
        result.push({
          ...message,
          content: [{ type: "text", text: (recovered ?? text) + "\n[Provisional voice transcription]" }],
        });
        spokenRequest = undefined;
        continue;
      }
      spokenRequest = undefined;
    }
    result.push(message);
  }
  return result;
}
