import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isLiveModel, type LiveModelId, type LiveProviderId, defaultLiveConfig } from "./providers";

export interface LiveConfig {
  provider: LiveProviderId;
  model: LiveModelId;
  openaiModel?: typeof import("./providers").LIVE_PROVIDERS.openai.models[number];
}
export function liveConfigPath(): string {
  return join(homedir(), ".die", "live-settings.json");
}
export function parseLiveConfig(value: unknown): LiveConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Live settings");
  const { provider, model, openaiModel } = value as Record<string, unknown>;
  if (model === "gpt-live-1" || openaiModel === "gpt-live-1")
    throw new Error(
      "GPT-Live is no longer supported. Edit ~/.die/live-settings.json to select gpt-realtime-2.1, or remove it to use Gemini. No fallback was started.",
    );
  if ((provider !== "google" && provider !== "openai") || !isLiveModel(provider, model))
    throw new Error("Invalid Live provider/model selection");
  if (openaiModel !== undefined && !isLiveModel("openai", openaiModel)) throw new Error("Invalid OpenAI voice model");
  return {
    provider,
    model,
    ...(openaiModel === undefined ? {} : { openaiModel: openaiModel as LiveConfig["openaiModel"] }),
  };
}
export async function loadLiveConfig(path = liveConfigPath()): Promise<LiveConfig> {
  try {
    return parseLiveConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultLiveConfig();
    throw new Error("Invalid Live settings at " + path + ": " + String(error));
  }
}
export async function saveLiveConfig(config: LiveConfig, path = liveConfigPath()): Promise<void> {
  const validated = parseLiveConfig(config);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(validated, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
