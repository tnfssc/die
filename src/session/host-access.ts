import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionHost } from "./host";

const HOST_ACCESS = "die:session:host-access";
interface AccessRequest {
  context: ExtensionContext;
  accept(host: SessionHost | undefined): void;
}
/** Extension APIs are distinct wrappers; their existing event bus is shared by the host runtime. */
export function registerSessionHost(
  pi: ExtensionAPI,
  accessor: (ctx: ExtensionContext) => SessionHost | undefined,
): () => void {
  return (
    pi.events?.on?.(HOST_ACCESS, (value: unknown) => {
      const request = value as AccessRequest;
      if (request?.context && typeof request.accept === "function") request.accept(accessor(request.context));
    }) ?? (() => {})
  );
}
export function getSessionHost(pi: ExtensionAPI, ctx: ExtensionContext): SessionHost | undefined {
  let host: SessionHost | undefined;
  pi.events?.emit(HOST_ACCESS, {
    context: ctx,
    accept: (value: SessionHost | undefined) => {
      host = value;
    },
  } satisfies AccessRequest);
  return host;
}
