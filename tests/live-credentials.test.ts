import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLiveKey, parseLiveKey } from "../src/live/credentials";

const fake = "not-a-real-key-12345";
describe("Live credentials", () => {
  test("parses literal assignment without executing shell", () => {
    expect(parseLiveKey('# comment\nexport GEMINI_API_KEY="' + fake + '"\n')).toBe(fake);
    expect(parseLiveKey("GEMINI_API_KEY=dotted.private-key_12345")).toBe("dotted.private-key_12345");
    for (const source of [
      "GEMINI_API_KEY=$(danger)",
      "GEMINI_API_KEY=secret bad",
      "",
      "GEMINI_API_KEY=" + fake + "\nGEMINI_API_KEY=" + fake,
    ]) {
      expect(() => parseLiveKey(source)).toThrow();
      try {
        parseLiveKey(source);
      } catch (error) {
        expect(String(error)).not.toContain(fake);
      }
    }
  });
  test("requires private regular file and never leaks file contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-live-key-test-"));
    const path = join(dir, "live.env");
    try {
      await writeFile(path, "GEMINI_API_KEY=" + fake, { mode: 0o600 });
      expect(await loadLiveKey(path)).toBe(fake);
      await chmod(path, 0o644);
      await expect(loadLiveKey(path)).rejects.toThrow("0600");
      await chmod(path, 0o600);
      await symlink(path, join(dir, "link"));
      await expect(loadLiveKey(join(dir, "link"))).rejects.toThrow("0600");
      await writeFile(path, "GEMINI_API_KEY=" + fake + " invalid");
      try {
        await loadLiveKey(path);
      } catch (error) {
        expect(String(error)).not.toContain(fake);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
