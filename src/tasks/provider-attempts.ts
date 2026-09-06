import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import { recordDiagnostic } from "../diagnostics.js";

export const PROVIDER_ATTEMPT_OBSERVED = "provider_attempt_observed";
export const PROVIDER_OBSERVER_FAILED = "observer_failed";

/** A conservatively observed provider attempt. Ordinary requests are reported
 * after a successful HTTP response or transport-independent successful terminal
 * event; direct native requests report only once fetch dispatch is inevitable. */
export interface ProviderAttemptEvent {
  model: Pick<Model<any>, "provider" | "id">;
  timestamp: number;
  observedAt: "response" | "dispatch";
  /** Unique correlation identity; never derived from provider data. */
  operationId: string;
}

export type ProviderAttemptListener = (event: ProviderAttemptEvent) => void;
const listeners = new WeakMap<object, Set<ProviderAttemptListener>>();

export function subscribeProviderAttempts(owner: object, listener: ProviderAttemptListener): () => void {
  let set = listeners.get(owner);
  if (!set) listeners.set(owner, (set = new Set()));
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(owner);
  };
}

/** Report an already-observed attempt. The optional final argument preserves
 * positional API compatibility while allowing a caller to propagate an ID. */
export function reportProviderAttempt(
  owner: object,
  model: Pick<Model<any>, "provider" | "id">,
  observedAt: ProviderAttemptEvent["observedAt"],
  timestamp = Date.now(),
  operationId = randomUUID(),
): void {
  const event: ProviderAttemptEvent = { model, observedAt, timestamp, operationId };
  recordDiagnostic(owner, {
    component: "provider",
    code: PROVIDER_ATTEMPT_OBSERVED,
    outcome: "success",
    operationId,
    dispatch: observedAt === "response" ? "response" : "initiated",
  });
  for (const listener of listeners.get(owner) ?? []) {
    try {
      listener(event);
    } catch {
      // Optional observers never alter provider dispatch or billing behavior.
      recordDiagnostic(owner, {
        component: "observer",
        code: PROVIDER_OBSERVER_FAILED,
        outcome: "failed",
        operationId,
        dispatch: observedAt === "response" ? "response" : "initiated",
      });
    }
  }
}
