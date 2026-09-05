import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import * as z from "zod/mini";

export const SUBAGENT_TYPES = ["fast", "normal", "orchestrator"] as const;
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type SubagentType = typeof SUBAGENT_TYPES[number];
export type ThinkingLevel = typeof THINKING_LEVELS[number];
const ProfileSchema = z.strictObject({
  model: z.optional(z.string().check(z.minLength(1), z.refine(value => value === value.trim() && value.includes("/") && !/\s/.test(value) && !value.startsWith("/") && !value.endsWith("/"), "Use provider/model"))),
  thinking: z.optional(z.enum(THINKING_LEVELS)),
});
const ProfilesSchema = z.strictObject({
  fast: z.optional(ProfileSchema), normal: z.optional(ProfileSchema), orchestrator: z.optional(ProfileSchema),
});
export type Profiles = Record<SubagentType, { model?: string; thinking?: ThinkingLevel }>;
export function profilesPath(): string { return join(homedir(), ".die", "subagents.json"); }
export function parseProfiles(value: unknown): Profiles {
  const parsed = z.parse(ProfilesSchema, value);
  return { fast: parsed.fast ?? {}, normal: parsed.normal ?? {}, orchestrator: parsed.orchestrator ?? {} };
}
export async function loadProfiles(path = profilesPath()): Promise<Profiles> {
  try { return parseProfiles(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseProfiles({});
    throw new Error("Invalid subagent settings at " + path + ": " + String(error));
  }
}
export async function saveProfiles(profiles: Profiles, path = profilesPath()): Promise<void> {
  const validated = parseProfiles(profiles);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(validated, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}
export function resolveProfile(profiles: Profiles, type: SubagentType, parent: { model?: string; thinking?: ThinkingLevel }) {
  const profile = profiles[type];
  const model = profile.model ?? parent.model;
  if (!model) throw new Error("No model is available for the sub-agent");
  return { model, thinking: profile.thinking ?? parent.thinking };
}
export function canDelegate(depth: number, type?: string): boolean {
  return depth < 2 && (depth === 0 || type === "orchestrator");
}
