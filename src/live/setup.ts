export interface LiveSetupUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
}

export interface LiveSetupStatus {
  configured: boolean;
  canImport: boolean;
  message: string;
}

export interface LiveSetupDependencies {
  /** Injectable for deterministic platform-specific setup guidance. */
  platform?(): NodeJS.Platform;
  status(): Promise<LiveSetupStatus>;
  importKey(): Promise<void>;
  capabilities(): Promise<{ supported: boolean; reason?: string }>;
  testConnection(): Promise<void>;
  start(): Promise<void>;
  /** False when the command/session which opened the wizard is no longer current. */
  isCurrent?(): boolean;
}

const IMPORT = "Import key from ~/.die/live.env";
const INSTRUCTIONS = "Show secure credential-file instructions";
const TEST = "Test paid connection (no microphone or speakers)";
const START = "Start Live";
const REFRESH = "Refresh / recheck";
const DONE = "Done";
const BACK = "Back";

const sharedOverview =
  "Audio and selected confirmed replies from this current session are shared with Google. Provider use is paid. Use headphones: there is no echo cancellation. Opening setup does not connect to Google or open audio devices.";

function platformOverview(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return `Gemini Live uses local macOS SoX with your default microphone and output. Install SoX with \`brew install sox\`. In System Settings > Privacy & Security > Microphone, allow access for Terminal (or the app running die), then restart Terminal or the app if necessary. If the app is not listed yet, macOS may ask when you explicitly start Live; setup does not request microphone access. ${sharedOverview}`;
  }
  if (platform !== "linux") return `Local Live audio supports Linux and macOS only (not SSH). ${sharedOverview}`;
  return `Gemini Live uses local Linux SoX with your default microphone and speakers. Install SoX with your distribution package manager and make sure the default input and output devices work. ${sharedOverview}`;
}

const credentialInstructions =
  "In an external local editor, create ~/.die/live.env as a user-owned regular file with mode 0600 and exactly one literal GEMINI_API_KEY=your-key assignment. Set private permissions before entering the key (chmod 600 ~/.die/live.env); do not overwrite an existing file. Never paste a key into chat, this wizard, ordinary CLI input, or a shell command containing the key. Return here and explicitly choose Import. Import saves the key in existing Google provider auth, preserves unrelated provider keys and OAuth, and leaves live.env in place.";

function alive(deps: LiveSetupDependencies): boolean {
  return deps.isCurrent?.() !== false;
}

/**
 * Consent-first terminal setup for Live. Inspection is local/side-effect-free;
 * paid network access and audio start happen only behind their own confirmation.
 */
export async function runLiveSetup(ui: LiveSetupUI, deps: LiveSetupDependencies): Promise<void> {
  if (!alive(deps)) return;
  ui.notify(platformOverview(deps.platform?.() ?? process.platform), "info");

  let status: LiveSetupStatus | undefined;
  let capability: { supported: boolean; reason?: string } | undefined;

  const refresh = async (): Promise<void> => {
    if (!alive(deps)) return;
    const [statusResult, capabilityResult] = await Promise.allSettled([deps.status(), deps.capabilities()]);
    if (!alive(deps)) return;

    if (statusResult.status === "fulfilled") {
      status = statusResult.value;
      ui.notify(status.message, status.configured ? "info" : "warning");
    } else {
      status = undefined;
      ui.notify("Could not inspect Live credentials. Refresh to try again.", "warning");
    }

    if (capabilityResult.status === "fulfilled") {
      capability = capabilityResult.value;
      if (!capability.supported)
        ui.notify(capability.reason || "Local Live audio prerequisites are unavailable.", "warning");
    } else {
      capability = undefined;
      ui.notify("Could not inspect local Live audio prerequisites. Refresh to try again.", "warning");
    }
  };

  await refresh();
  while (alive(deps)) {
    const options: string[] = [];
    if (status?.configured && capability?.supported) options.push(START);
    if (status?.configured) options.push(TEST);
    if (status?.canImport) options.push(IMPORT);
    options.push(INSTRUCTIONS, REFRESH, DONE);

    const choice = await ui.select(
      `Gemini Live setup\nKey: ${status?.configured ? "configured" : status ? "not configured" : "check failed"} | Audio tools: ${capability?.supported ? "ready (devices untested)" : capability ? "unavailable" : "check failed"}`,
      options,
    );
    if (!alive(deps) || choice === undefined || choice === DONE) return;

    if (choice === INSTRUCTIONS) {
      ui.notify(credentialInstructions, "info");
      const back = await ui.select("Credential file", [BACK]);
      if (!alive(deps) || back === undefined) return;
      continue;
    }

    if (choice === REFRESH) {
      await refresh();
      continue;
    }

    if (choice === IMPORT) {
      // The option is deliberately absent until a side-effect-free inspection
      // confirms that Google provider auth can accept an import. The file is read only after consent.
      if (!status?.canImport) continue;
      const consent = await ui.confirm(
        "Import the Live key?",
        "Read ~/.die/live.env now and save its GEMINI_API_KEY in existing Google provider auth? Unrelated provider keys and OAuth are preserved, and the file remains in place.",
      );
      if (!alive(deps) || !consent) continue;
      try {
        await deps.importKey();
        if (!alive(deps)) return;
        ui.notify("Live key imported into existing Google provider auth. ~/.die/live.env was left in place.", "info");
        await refresh();
      } catch {
        if (!alive(deps)) return;
        ui.notify(
          "Could not import the Live key. Check the file, ownership, and mode; refresh provider status before retrying. An existing Google credential is never replaced.",
          "error",
        );
      }
      continue;
    }

    if (choice === TEST) {
      if (!status?.configured) continue;
      const consent = await ui.confirm(
        "Run a paid connection test?",
        "This makes a paid Google setup connection only. It does not open the microphone or speakers and does not start Live.",
      );
      if (!alive(deps) || !consent) continue;
      ui.notify("Testing paid setup connection (up to 15 seconds). No audio devices will open.", "info");
      try {
        await deps.testConnection();
        if (!alive(deps)) return;
        ui.notify("Paid setup connection succeeded. No microphone or speakers were opened.", "info");
      } catch {
        if (!alive(deps)) return;
        ui.notify("The paid setup connection test failed. No audio devices were opened.", "error");
      }
      continue;
    }

    if (choice === START) {
      if (!status?.configured || !capability?.supported) continue;
      const consent = await ui.confirm(
        "Start Live now?",
        "Start a paid Google Live session and open the local default microphone and speakers? Audio and selected confirmed replies from this current session will be shared with Google. Use headphones; there is no echo cancellation.",
      );
      if (!alive(deps) || !consent) continue;
      try {
        await deps.start();
        if (!alive(deps)) return;
        ui.notify("Live start requested.", "info");
        return;
      } catch {
        if (!alive(deps)) return;
        ui.notify("Live could not start. No automatic retry was made.", "error");
      }
    }
  }
}
