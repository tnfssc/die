import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ModelSelectEvent,
} from "@earendil-works/pi-coding-agent";
import {
  isExplicitRootCliModelSelection,
  registerLastUsedCliModel,
  type ModelDefaultSettings,
} from "../src/agent/last-used-cli-model";

function event(source: ModelSelectEvent["source"] = "set"): ModelSelectEvent {
  return {
    type: "model_select",
    source,
    model: { provider: "anthropic", id: "claude-test" } as ModelSelectEvent["model"],
    previousModel: undefined,
  };
}

function context(mode: ExtensionContext["mode"] = "tui"): ExtensionContext {
  return {
    mode,
    cwd: "/project",
    ui: { notify() {} },
  } as unknown as ExtensionContext;
}

describe("last-used CLI model", () => {
  test("recognizes only direct root TUI selections", () => {
    expect(isExplicitRootCliModelSelection(event("set"), context("tui"), true)).toBe(true);
    expect(isExplicitRootCliModelSelection(event("restore"), context("tui"), true)).toBe(false);
    expect(isExplicitRootCliModelSelection(event("cycle"), context("tui"), true)).toBe(true);
    expect(isExplicitRootCliModelSelection(event("set"), context("print"), true)).toBe(false);
    expect(isExplicitRootCliModelSelection(event("set"), context("json"), true)).toBe(false);
    expect(isExplicitRootCliModelSelection(event("set"), context("rpc"), true)).toBe(false);
    expect(isExplicitRootCliModelSelection(event("set"), context("tui"), false)).toBe(false);
  });

  test("persists provider and model after an explicit /model choice", async () => {
    let handler: ((event: ModelSelectEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
    const pi = {
      on(name: string, candidate: typeof handler) {
        expect(name).toBe("model_select");
        handler = candidate;
      },
    } as unknown as ExtensionAPI;
    const writes: string[] = [];
    const settings: ModelDefaultSettings = {
      setDefaultModelAndProvider(provider, modelId) {
        writes.push(`${provider}/${modelId}`);
      },
      async flush() {},
      drainErrors: () => [],
    };

    registerLastUsedCliModel(
      pi,
      () => true,
      (cwd) => {
        expect(cwd).toBe("/project");
        return settings;
      },
    );
    await handler!(event(), context());
    await handler!(event("cycle"), context());
    expect(writes).toEqual(["anthropic/claude-test", "anthropic/claude-test"]);
  });

  test("automatic restores, command overrides, and children do not overwrite defaults", async () => {
    let handler: ((event: ModelSelectEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
    const pi = { on: (_name: string, candidate: typeof handler) => (handler = candidate) } as unknown as ExtensionAPI;
    let root = true;
    let creates = 0;
    registerLastUsedCliModel(
      pi,
      () => root,
      () => {
        creates++;
        throw new Error("settings should not be opened");
      },
    );

    await handler!(event("restore"), context());
    await handler!(event("set"), context("print")); // e.g. an explicit --model noninteractive run
    root = false;
    await handler!(event("set"), context("tui"));
    expect(creates).toBe(0);
  });
});

test("saved choice survives a fresh settings instance without changing unrelated settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-model-default-"));
  try {
    const cwd = join(dir, "project");
    const agentDir = join(dir, "agent");
    await mkdir(cwd);
    await mkdir(agentDir);
    await Bun.write(
      join(agentDir, "settings.json"),
      JSON.stringify({ defaultProvider: "old", defaultModel: "old-model", theme: "light" }),
    );
    let handler: ((event: ModelSelectEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
    const pi = { on: (_name: string, candidate: typeof handler) => (handler = candidate) } as unknown as ExtensionAPI;
    registerLastUsedCliModel(
      pi,
      () => true,
      () => SettingsManager.create(cwd, agentDir),
    );
    await handler!(event(), context());
    const fresh = SettingsManager.create(cwd, agentDir);
    expect(fresh.getDefaultProvider()).toBe("anthropic");
    expect(fresh.getDefaultModel()).toBe("claude-test");
    expect((await Bun.file(join(agentDir, "settings.json")).json()).theme).toBe("light");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
