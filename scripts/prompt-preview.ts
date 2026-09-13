#!/usr/bin/env bun

import { resolve } from "node:path";
import { createPromptPreview, PREVIEW_ROLES, type PreviewRole } from "../src/prompt-preview";
import { MAIN_AGENT_MODES, type MainAgentMode } from "../src/prompts";

function help(): string {
  return `Usage: bun run prompt:preview -- [options]

Capture the real production prompt assembly without a network or model call.
The default uses a temporary isolated project; external project context is excluded.

Options:
  --project <path>  Select project/ancestor instruction files and .die/{SYSTEM,APPEND_SYSTEM}.md
  --role <role>     root (default), fast, normal, or orchestrator; non-root values are child roles
  --mode <mode>     Root instruction mode: fast, normal, or orchestrator (default)
  --message <text>  User message assembled into the captured request
  --goal <text>     Include a representative paused goal and its real injected context message
  -h, --help        Show this help

Output is JSON containing the exact captured systemPrompt, tools, and messages.`;
}

function value(args: string[], index: number, option: string): string {
  const result = args[index + 1];
  if (!result || result.startsWith("--")) throw new Error(`${option} requires a value`);
  return result;
}

const args = process.argv.slice(2);
const options: Parameters<typeof createPromptPreview>[0] = {};
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (!arg) continue;
  if (arg === "--help" || arg === "-h") {
    console.log(help());
    process.exit(0);
  }
  if (arg === "--project") options.project = resolve(value(args, index++, arg));
  else if (arg === "--message") options.message = value(args, index++, arg);
  else if (arg === "--goal") options.goal = value(args, index++, arg);
  else if (arg === "--role") {
    const role = value(args, index++, arg);
    if (!PREVIEW_ROLES.includes(role as PreviewRole)) throw new Error(`Invalid --role: ${role}`);
    options.role = role as PreviewRole;
  } else if (arg === "--mode") {
    const mode = value(args, index++, arg);
    if (!MAIN_AGENT_MODES.includes(mode as MainAgentMode)) throw new Error(`Invalid --mode: ${mode}`);
    options.rootMode = mode as MainAgentMode;
  } else throw new Error(`Unknown option: ${arg}\n\n${help()}`);
}

console.log(JSON.stringify(await createPromptPreview(options), null, 2));
