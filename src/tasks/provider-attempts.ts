import type { Model } from "@earendil-works/pi-ai";

/** A conservatively observed provider attempt. Ordinary requests are reported
 * only once an HTTP response exists; direct native requests report at fetch
 * dispatch. No queue or history is retained here. */
export interface ProviderAttemptEvent {
  model: Pick<Model<any>, "provider" | "id">;
  timestamp: number;
  observedAt: "response" | "dispatch";
}

export type ProviderAttemptListener = (event: ProviderAttemptEvent) => void;
const listeners = new WeakMap<object, Set<ProviderAttemptListener>>();

/** Subscribe to attempts owned by one in-memory session manager. */
export function subscribeProviderAttempts(owner: object, listener: ProviderAttemptListener): () => void {
  let set = listeners.get(owner);
  if (!set) listeners.set(owner, set = new Set());
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(owner);
  };
}

/** Report an already-observed attempt. Synchronous so model identity cannot
 * drift across an await or model switch. */
export function reportProviderAttempt(owner: object, model: Pick<Model<any>, "provider" | "id">, observedAt: ProviderAttemptEvent["observedAt"], timestamp = Date.now()): void {
  const event = { model, observedAt, timestamp };
  for (const listener of listeners.get(owner) ?? []) listener(event);
}
