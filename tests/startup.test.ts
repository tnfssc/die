import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { installQuietStartup } from "../src/ui/startup";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

async function fixture(settings: object = {}) {
  const root = await mkdtemp(join(tmpdir(), "die-startup-"));
  const agentDir = join(root, "agent");
  await Bun.write(join(agentDir, "settings.json"), JSON.stringify(settings));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return { root, agentDir, path: join(agentDir, "settings.json") };
}

describe("quiet startup", () => {
  test("uses Pi's quietStartup override without changing resource behavior", async () => {
    const { root, agentDir } = await fixture({ quietStartup: false, enableSkillCommands: true });
    const restore = installQuietStartup();
    cleanup.push(restore);

    const manager = SettingsManager.create(root, agentDir);

    expect(manager.getQuietStartup()).toBe(true);
    expect(manager.getEnableSkillCommands()).toBe(true);
  });

  test("does not persist the product override to user settings", async () => {
    const original = { quietStartup: false, skills: ["skills/example"], enableSkillCommands: true };
    const { root, agentDir, path } = await fixture(original);
    const restore = installQuietStartup();
    cleanup.push(restore);

    const manager = SettingsManager.create(root, agentDir);
    expect(manager.getSkillPaths()).toEqual(["skills/example"]);
    manager.setTheme("light");
    await manager.flush();
    await manager.reload();
    expect(manager.getQuietStartup()).toBe(true);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({...original, theme:"light"});
  });

  test("restores the startup getter for callers and tests", async () => {
    const { root, agentDir } = await fixture();
    const restore = installQuietStartup();
    restore();

    expect(SettingsManager.create(root, agentDir).getQuietStartup()).toBe(false);
  });
});
