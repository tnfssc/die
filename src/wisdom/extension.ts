import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import wisdomGuidance from "../prompts/wisdom.md" with { type: "text" };

export interface ProjectWisdomOptions {
  isRoot: () => boolean;
}

export interface ProjectWisdomRuntime {
  jobsChanged(): Promise<void>;
}

function rootAllowed(callback: () => boolean): boolean {
  try {
    return callback() === true;
  } catch {
    return false;
  }
}

export function registerProjectWisdom(pi: ExtensionAPI, options: ProjectWisdomOptions): ProjectWisdomRuntime {
  let currentContext: ExtensionContext | undefined;

  const notify = (message: string, severity?: "warning") => currentContext?.ui?.notify(message, severity);

  pi.registerCommand("wisdom", {
    description: "Show where project wisdom lives",
    async handler(_args, ctx) {
      currentContext = ctx;
      if (!rootAllowed(options.isRoot))
        return notify("Project wisdom is unavailable outside the root agent.", "warning");
      return notify("Project wisdom lives in wisdom/. Put it with the feature or system it explains.");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
  });
  pi.on("session_shutdown", () => {
    currentContext = undefined;
  });
  pi.on("before_agent_start", (event, ctx) => {
    currentContext = ctx;
    if (!rootAllowed(options.isRoot)) return;
    return {
      systemPrompt: event.systemPrompt + "\n\n" + wisdomGuidance.trimEnd(),
    };
  });

  return { jobsChanged: async () => {} };
}
