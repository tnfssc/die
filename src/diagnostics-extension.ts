import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { attachDiagnosticSink, inspectDiagnostics, scanDiagnosticRecords } from "./diagnostics";

type SessionLike = {
  getSessionId?: () => unknown;
  getEntries?: () => unknown;
  getLeafId?: () => unknown;
  branch?: (entryId: string) => void;
  resetLeaf?: () => void;
};

function sessionId(manager: SessionLike | undefined): unknown {
  try {
    return manager?.getSessionId?.();
  } catch {
    return undefined;
  }
}

function entries(manager: SessionLike | undefined): readonly unknown[] {
  try {
    const value = manager?.getEntries?.() ?? [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Prepare and preflight a public-API restoration before writing. Diagnostics
 * are refused when the active leaf cannot be read or restoration already fails.
 * The later append/restore pair cannot be transactional through this API. */
function leafRestorer(manager: SessionLike): (() => void) | undefined {
  try {
    if (typeof manager.getLeafId !== "function") return;
    const leafId = manager.getLeafId();
    if (leafId === null) {
      if (typeof manager.resetLeaf !== "function") return;
      const resetLeaf = manager.resetLeaf.bind(manager);
      // As with branch(), reject a restoration that is already known to fail.
      resetLeaf();
      return () => resetLeaf();
    }
    if (typeof leafId !== "string" || typeof manager.branch !== "function") return;
    const branch = manager.branch.bind(manager);
    // The pinned SDK's branch() validates before changing its leaf. Probe the
    // saved leaf now so an already-impossible restoration refuses the optional
    // write instead of discovering that only after appendEntry has mutated the
    // session. This is only a preflight: custom implementations can still fail
    // on the later restoration call.
    branch(leafId);
    return () => branch(leafId);
  } catch {
    return;
  }
}

/** Installs durable diagnostic capture and a metadata-only /diagnostics view. */
export function registerOperationDiagnostics(pi: ExtensionAPI): void {
  let detach: (() => void) | undefined;
  let owner: object | undefined;
  let activeSessionId: unknown;
  pi.on("session_start", (_event, ctx) => {
    detach?.();
    const capturedOwner = ctx.sessionManager as object;
    const capturedSessionId = sessionId(capturedOwner as SessionLike);
    owner = capturedOwner;
    activeSessionId = capturedSessionId;
    detach = attachDiagnosticSink(
      capturedOwner,
      (type, data) => {
        // appendEntry follows pi's mutable session, so reject closures captured for another session.
        if (owner !== capturedOwner || activeSessionId !== capturedSessionId) return;
        if (sessionId(capturedOwner) !== capturedSessionId) return;
        const restoreLeaf = leafRestorer(capturedOwner as SessionLike);
        if (!restoreLeaf) throw new Error("Diagnostic persistence requires a restorable session leaf");
        try {
          pi.appendEntry(type, data);
        } finally {
          restoreLeaf();
        }
      },
      entries(capturedOwner as SessionLike),
    );
  });
  pi.on("session_shutdown", () => {
    // Do not detach here: later shutdown listeners may still emit lifecycle diagnostics.
    // The next session_start invalidates and detaches this generation before switching.
  });
  pi.registerCommand("diagnostics", {
    description: "Show bounded operational diagnostic metadata (add 'durable' to replay session records)",
    handler: async (args, ctx) => {
      const commandOwner = ctx.sessionManager as object;
      if (!owner || owner !== commandOwner || sessionId(commandOwner as SessionLike) !== activeSessionId) {
        ctx.ui.notify("Diagnostics unavailable before session start", "warning");
        return;
      }
      const snapshot = inspectDiagnostics(owner);
      const includeDurable = args.trim().toLowerCase() === "durable";
      const replay = includeDurable ? scanDiagnosticRecords(entries(commandOwner as SessionLike)) : undefined;
      const output = {
        ...snapshot,
        ...(replay
          ? {
              durable: replay.records,
              durableScan: {
                scanned: replay.scanned,
                scanLimit: replay.scanLimit,
                scanLimited: replay.scanLimited,
              },
            }
          : {}),
      };
      ctx.ui.notify(JSON.stringify(output, null, 2), "info");
    },
  });
}
