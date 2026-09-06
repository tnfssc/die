import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { attachDiagnosticSink, diagnosticRecords, inspectDiagnostics } from "./diagnostics";

/** Installs durable diagnostic capture and a metadata-only /diagnostics view. */
export function registerOperationDiagnostics(pi: ExtensionAPI): void {
  let detach: (() => void) | undefined;
  let owner: object | undefined;
  pi.on("session_start", (_event, ctx) => {
    detach?.();
    owner = ctx.sessionManager as object;
    detach = attachDiagnosticSink(owner, (type, data) => pi.appendEntry(type, data));
  });
  pi.on("session_shutdown", () => {
    detach?.();
    detach = undefined;
    owner = undefined;
  });
  pi.registerCommand("diagnostics", {
    description: "Show bounded operational diagnostic metadata (add 'durable' to replay session records)",
    handler: async (args, ctx) => {
      if (!owner) {
        ctx.ui.notify("Diagnostics unavailable before session start", "warning");
        return;
      }
      const snapshot = inspectDiagnostics(owner);
      const includeDurable = args.trim().toLowerCase() === "durable";
      const branch = includeDurable
        ? (ctx.sessionManager?.getBranch?.() ?? ctx.sessionManager?.getEntries?.() ?? [])
        : [];
      const output = { ...snapshot, ...(includeDurable ? { durable: diagnosticRecords(branch) } : {}) };
      ctx.ui.notify(JSON.stringify(output, null, 2), "info");
    },
  });
}
