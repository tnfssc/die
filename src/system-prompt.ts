import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dieSystemPrompt } from "./prompts";

function optionBoundary(args: string[]): number {
  const boundary = args.indexOf("--");
  return boundary < 0 ? args.length : boundary;
}

/**
 * Supply Die's base through Pi's --system-prompt path, so Pi performs normal
 * custom-prompt assembly. Explicit CLI, project, and global SYSTEM.md bases win.
 */
export function withDieSystemPrompt(
  args: string[],
  options: { cwd?: string; agentDir?: string; projectTrusted?: boolean } = {},
): string[] {
  const boundary = optionBoundary(args);
  if (args.slice(0, boundary).includes("--system-prompt")) return args;

  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? process.env.DIE_CODING_AGENT_DIR ?? join(homedir(), ".die", "agent");
  // Pi ignores project prompt files when project trust is denied. Honor its
  // last trust override rather than treating mere file existence as selection.
  let projectTrusted = options.projectTrusted;
  for (const arg of args.slice(0, boundary)) {
    if (arg === "--approve" || arg === "-a") projectTrusted = true;
    else if (arg === "--no-approve" || arg === "-na") projectTrusted = false;
  }
  const projectPrompt = existsSync(join(cwd, ".die", "SYSTEM.md"));
  const globalPrompt = existsSync(join(agentDir, "SYSTEM.md"));
  if ((projectPrompt && projectTrusted !== false) || globalPrompt) return args;

  const result = [...args];
  result.splice(boundary, 0, "--system-prompt", dieSystemPrompt());
  return result;
}
