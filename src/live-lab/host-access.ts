import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LiveHostBridge } from "./host-bridge";

// Synchronous access to the *owning* tasks extension's service. Never create
// a second JobService/TaskManager from the voice extension.
const accessors = new WeakMap<ExtensionAPI, (ctx: ExtensionContext) => LiveHostBridge | undefined>();
export function registerLiveHost(pi: ExtensionAPI, accessor: (ctx: ExtensionContext) => LiveHostBridge | undefined): () => void {
  accessors.set(pi, accessor);
  return () => { if (accessors.get(pi) === accessor) accessors.delete(pi); };
}
export function getLiveHost(pi: ExtensionAPI, ctx: ExtensionContext): LiveHostBridge | undefined {
  return accessors.get(pi)?.(ctx);
}
