import { dirname, join, resolve } from "node:path";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";

/** A stable attribution identity, including sessions started with --no-session. */
export function sessionCostRoot(
  manager: ExtensionContext["sessionManager"],
): { file: string; directory: string } | undefined {
  const file = manager.getSessionFile?.();
  if (file) return { file, directory: manager.getSessionDir?.() || dirname(file) };
  const id = manager.getSessionId?.();
  if (!id) return undefined;
  // Match Pi's per-cwd session directory; children still use normal JSONL storage.
  const cwd = resolve(manager.getCwd());
  const safePath = "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--";
  const directory = manager.getSessionDir() || join(getAgentDir(), "sessions", safePath);
  // This is an identity only: no fake parent session is written to disk.
  return { file: join(directory, ".die-ephemeral-" + id + ".jsonl"), directory };
}
