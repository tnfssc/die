import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

test("real TUI searches profile models, keeps selection, and saves", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-profile-pty-"));
  const socket = "die-profiles-" + process.pid + "-" + Date.now();
  const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args]);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  async function frameContaining(text: string) {
    let frame = "";
    for (let attempt = 0; attempt < 80; attempt++) {
      frame = (await tmux("capture-pane", "-p", "-t", "profiles")).stdout;
      if (frame.includes(text)) return frame;
      await Bun.sleep(50);
    }
    throw new Error("Missing " + text + " in frame:\n" + frame);
  }
  const key = (...keys: string[]) => tmux("send-keys", "-t", "profiles", ...keys);
  try {
    const binary = resolve(import.meta.dir, "../dist/die");
    const launch = [
      "env",
      "HOME=" + home,
      "DIE_CODING_AGENT_DIR=" + join(home, ".die", "agent"),
      "OPENAI_API_KEY=offline-test-placeholder",
      binary,
      "--offline",
      "--no-session",
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(quote)
      .join(" ");
    expect((await tmux("new-session", "-d", "-s", "profiles", "-x", "120", "-y", "40", "-c", home, launch)).code).toBe(
      0,
    );
    await frameContaining("gpt-4o");
    // The footer is painted before startup binds extension commands.
    await Bun.sleep(1000);
    await tmux("send-keys", "-t", "profiles", "-l", "/subagents");
    await key("Enter");
    await frameContaining("Sub-agent profiles");
    await key("Enter");
    await frameContaining("fast · model");
    await tmux("send-keys", "-t", "profiles", "-l", "openai gpt-4o");
    // Wait for the entire query, not an item already visible in the unfiltered list.
    const searchFrame = await frameContaining("openai gpt-4o");
    await key("Enter");
    await frameContaining("Sub-agent profiles");
    await key("Down", "Enter");
    await frameContaining("fast · thinking");
    await key("Down", "Enter");
    await frameContaining("Sub-agent profiles");
    // Returning from thinking keeps row 1 selected. Five downs reaches Save.
    await key("Down", "Down", "Down", "Down", "Down", "Enter");
    await frameContaining("Saved");
    const saved = JSON.parse(await readFile(join(home, ".die", "subagents.json"), "utf8"));
    if (saved.fast.model !== "openai/gpt-4o") console.log(searchFrame);
    expect(saved.fast.model).toBe("openai/gpt-4o");
    expect(saved.fast.thinking).toBe("off");
  } finally {
    await tmux("kill-server");
    await rm(home, { recursive: true, force: true });
  }
}, 15000);
