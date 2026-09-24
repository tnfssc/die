import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getJobResponseDeliverySignal,
  JOB_RESPONSE_ACK_EVENT,
  supportsJobResponseAcknowledgement,
} from "../typescript/job-bridge";

export type ForegroundStopResult = { outcome: "pending" | "idle" | "error"; detail?: string };
/** Do not abort the execute bridge before its stop-work result reaches the caller.
 * ACK is delivery, not completion: only the host's idle state proves the turn ended.
 */
export function requestForegroundStop(
  ctx: Pick<ExtensionContext, "abort" | "isIdle" | "sessionManager">,
  signal: AbortSignal,
  observe: (result: ForegroundStopResult) => void,
): ForegroundStopResult {
  if (ctx.isIdle()) return { outcome: "idle" };
  if (!supportsJobResponseAcknowledgement(signal))
    return { outcome: "error", detail: "Foreground cancellation requires an acknowledged execute bridge" };
  const delivery = getJobResponseDeliverySignal(signal)!;
  const session = ctx.sessionManager.getSessionId();
  const leaf = ctx.sessionManager.getLeafId();
  const cleanup = () => {
    delivery.removeEventListener(JOB_RESPONSE_ACK_EVENT, stop);
    signal.removeEventListener("abort", cleanup);
  };
  const stop = () => {
    cleanup();
    if (ctx.sessionManager.getSessionId() !== session || ctx.sessionManager.getLeafId() !== leaf) {
      observe({ outcome: "error", detail: "Session or branch changed before foreground cancellation" });
      return;
    }
    try {
      ctx.abort();
      observe({ outcome: ctx.isIdle() ? "idle" : "pending" });
    } catch {
      observe({ outcome: "error", detail: "Foreground cancellation failed" });
    }
  };
  if (signal.aborted) return { outcome: "error", detail: "Execute caller already cancelled" };
  delivery.addEventListener(JOB_RESPONSE_ACK_EVENT, stop, { once: true });
  signal.addEventListener("abort", cleanup, { once: true });
  return { outcome: "pending", detail: "Foreground cancellation will be requested after result delivery" };
}
