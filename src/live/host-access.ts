import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LiveHostBridge } from "./host-bridge";

const HOST_ACCESS = "die:live:host-access";
interface AccessRequest {
  context: ExtensionContext;
  accept(host: LiveHostBridge | undefined): void;
}
/** Extension APIs are distinct wrappers; their existing event bus is shared by the host runtime. */
export function registerLiveHost(
  pi: ExtensionAPI,
  accessor: (ctx: ExtensionContext) => LiveHostBridge | undefined,
): () => void {
  return (
    pi.events?.on?.(HOST_ACCESS, (value: unknown) => {
      const request = value as AccessRequest;
      if (request?.context && typeof request.accept === "function") request.accept(accessor(request.context));
    }) ?? (() => {})
  );
}
export function getLiveHost(pi: ExtensionAPI, ctx: ExtensionContext): LiveHostBridge | undefined {
  let host: LiveHostBridge | undefined;
  pi.events?.emit(HOST_ACCESS, {
    context: ctx,
    accept: (value: LiveHostBridge | undefined) => {
      host = value;
    },
  } satisfies AccessRequest);
  return host;
}
