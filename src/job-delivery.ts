export const JOB_RESPONSE_ACK_EVENT = "die:job-response-ack";
const ACK_CAPABLE = Symbol.for("die.job-response-ack-capable");

const RESPONSE_DELIVERY_SIGNAL = Symbol.for("die.job-response-delivery-signal");
const REQUEST_IDENTITY = Symbol.for("die.job-request-identity");
export interface JobRequestIdentity {
  /** Durable identity of the outer execute tool call. */
  executeInvocationId: string;
  /** One-based bridge call ordinal within that execute invocation. */
  callIndex: number;
}
type AckCapableSignal = AbortSignal & {
  [ACK_CAPABLE]?: boolean;
  [RESPONSE_DELIVERY_SIGNAL]?: AbortSignal;
  [REQUEST_IDENTITY]?: JobRequestIdentity;
};

/** Use this ID for durable native mutation replay. Equal payloads do not mean equal intent. */
export function getJobRequestIdentity(signal?: AbortSignal): JobRequestIdentity | undefined {
  return signal ? (signal as AckCapableSignal)[REQUEST_IDENTITY] : undefined;
}

/** Add the bridge request ID without losing cancellation or delivery metadata. */
export function withJobRequestIdentity(signal: AbortSignal, identity: JobRequestIdentity): AbortSignal {
  if (
    !identity.executeInvocationId ||
    identity.executeInvocationId.length > 512 ||
    !Number.isSafeInteger(identity.callIndex) ||
    identity.callIndex < 1
  )
    throw new Error("Invalid execute bridge request identity");
  Object.defineProperty(signal, REQUEST_IDENTITY, { value: Object.freeze({ ...identity }) });
  return signal;
}

/** Return the bridge signal that tracks response delivery. */
export function getJobResponseDeliverySignal(signal?: AbortSignal): AbortSignal | undefined {
  return signal ? ((signal as AckCapableSignal)[RESPONSE_DELIVERY_SIGNAL] ?? signal) : undefined;
}

/** True when a handler signal can confirm that its result reached the worker. */
export function supportsJobResponseAcknowledgement(signal?: AbortSignal): boolean {
  const deliverySignal = getJobResponseDeliverySignal(signal);
  return !!deliverySignal && (deliverySignal as AckCapableSignal)[ACK_CAPABLE] === true;
}

/**
 * Add local cancellation without losing the bridge signal's delivery ID. The ID
 * travels separately because AbortSignal.any() keeps only abort state. Cancelling
 * a local wait must not cancel inline delivery.
 */
export function withJobCancellation(signal: AbortSignal, cancellation: AbortSignal): AbortSignal {
  if (signal === cancellation) return signal;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const deliverySignal = getJobResponseDeliverySignal(signal)!;
  const cleanup = (): void => {
    signal.removeEventListener("abort", abort);
    cancellation.removeEventListener("abort", abort);
    deliverySignal.removeEventListener(JOB_RESPONSE_ACK_EVENT, cleanup);
  };
  signal.addEventListener("abort", abort, { once: true });
  cancellation.addEventListener("abort", abort, { once: true });
  controller.signal.addEventListener("abort", cleanup, { once: true });
  Object.defineProperty(controller.signal, RESPONSE_DELIVERY_SIGNAL, { value: deliverySignal });
  const requestIdentity = getJobRequestIdentity(signal);
  if (requestIdentity) Object.defineProperty(controller.signal, REQUEST_IDENTITY, { value: requestIdentity });
  // A clean acknowledgement is also the end of this wrapper's lifetime. The
  // TaskManager listens to deliverySignal directly; it must not mistake local
  // wait cancellation (for example, handoff) for a bridge disconnect.
  if (supportsJobResponseAcknowledgement(deliverySignal)) {
    deliverySignal.addEventListener(JOB_RESPONSE_ACK_EVENT, cleanup, { once: true });
  }
  if (signal.aborted || cancellation.aborted) abort();
  return controller.signal;
}

/** Mark a bridge request as able to acknowledge delivery. */
export function enableJobResponseAcknowledgement(signal: AbortSignal): void {
  Object.defineProperty(signal, ACK_CAPABLE, { value: true });
}
