import { existsSync } from "node:fs";
import { liveCredentialsPath, type LiveCredentialService } from "./credentials";

export interface LiveSetupUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning"): void;
}

/** Configuration only. The caller owns cancellation and any explicitly requested start. */
export async function runLiveSetup(
  ui: LiveSetupUI,
  credentials: LiveCredentialService,
  signal: AbortSignal,
  importAvailable: () => boolean = () => existsSync(liveCredentialsPath()),
  allowStart = true,
): Promise<boolean> {
  let explained: string | undefined;
  while (!signal.aborted) {
    const status = await credentials.status(signal);
    if (signal.aborted) return false;
    if (status.state === "stored_api_key" || status.state === "configured_api_key") {
      const choice = await ui.select(
        allowStart ? "Live" : "Google API key configured",
        allowStart ? ["Start voice", "Done"] : ["Done"],
      );
      return !signal.aborted && choice === "Start voice";
    }
    const canImport = status.canImport && importAvailable();
    const instructions =
      status.state === "oauth"
        ? "Live needs a Google API key. Your Google OAuth credential will not be replaced. Manage Google credentials outside Live, then recheck."
        : canImport
          ? "Import saves the key from ~/.die/live.env to Google provider auth. Existing credentials are never replaced."
          : "Create ~/.die/live.env in a local editor with one GEMINI_API_KEY assignment. Set permissions to 0600 before entering the key; do not overwrite an existing file. Never paste keys into chat or shell commands. Return here to import into Google provider auth.";
    if (explained !== instructions) {
      ui.notify(instructions, "info");
      explained = instructions;
    }
    if (signal.aborted) return false;
    const choice = await ui.select("Google API key required", [
      ...(canImport ? ["Import ~/.die/live.env"] : []),
      "Recheck",
      "Cancel",
    ]);
    if (signal.aborted || !choice || choice === "Cancel") return false;
    if (choice === "Import ~/.die/live.env" && canImport) {
      try {
        await credentials.importLiveEnv(undefined, signal);
      } catch {
        if (!signal.aborted) ui.notify("Could not import. Check the file and its permissions.", "warning");
      }
    } else if (choice !== "Recheck") return false;
  }
  return false;
}
