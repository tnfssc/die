import { describe, test, expect } from "bun:test";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProfiles, loadProfiles, saveProfiles, resolveProfile, canDelegate } from "../src/tasks/subagent-profiles";

describe("subagent profiles", () => {
  test("defaults inherit and explicit thinking off is preserved", () => {
    const profiles = parseProfiles({ fast: { model: "provider/fast", thinking: "off" } });
    expect(resolveProfile(profiles, "fast", { model: "p/parent", thinking: "high" })).toEqual({
      model: "provider/fast",
      thinking: "off",
    });
    expect(resolveProfile(profiles, "normal", { model: "p/parent", thinking: "high" })).toEqual({
      model: "p/parent",
      thinking: "high",
    });
    expect(() => resolveProfile(profiles, "normal", {})).toThrow("No model");
  });
  test("invalid settings fail closed", () => {
    for (const value of [
      null,
      [],
      { typo: {} },
      { fast: { thinking: "bad" } },
      { normal: { model: "" } },
      { normal: { model: "bare" } },
      { fast: { extra: 1 } },
    ])
      expect(() => parseProfiles(value)).toThrow();
  });
  test("only root and first-level orchestrators delegate", () => {
    expect(canDelegate(0)).toBe(true);
    expect(canDelegate(1, "orchestrator")).toBe(true);
    for (const type of ["fast", "normal", undefined]) expect(canDelegate(1, type)).toBe(false);
    expect(canDelegate(2, "orchestrator")).toBe(false);
  });
  test("missing file inherits; saves roundtrip; malformed file errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-profiles-"));
    const path = join(dir, "nested", "subagents.json");
    try {
      expect(await loadProfiles(path)).toEqual(parseProfiles({}));
      const profiles = parseProfiles({ orchestrator: { model: "p/coordinator", thinking: "high" } });
      await saveProfiles(profiles, path);
      expect(await loadProfiles(path)).toEqual(profiles);
      if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
      await writeFile(path, "{");
      await expect(loadProfiles(path)).rejects.toThrow("Invalid subagent settings");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
