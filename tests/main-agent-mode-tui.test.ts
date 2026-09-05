import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { run } from "./helpers";

test("real TUI /mode reports and switches the root instruction mode", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-mode-pty-"));
  const socket = "die-mode-" + process.pid + "-" + Date.now();
  const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args]);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\''") + "'";
  async function frameContaining(text: string) {
    let frame = "";
    for (let attempt = 0; attempt < 80; attempt++) {
      frame = (await tmux("capture-pane", "-p", "-t", "mode")).stdout;
      if (frame.includes(text)) return frame;
      await Bun.sleep(50);
    }
    throw new Error("Missing " + text + " in frame:\n" + frame);
  }
  async function command(value: string) {
    await tmux("send-keys", "-t", "mode", "-l", value);
    await Bun.sleep(100);
    await tmux("send-keys", "-t", "mode", "Enter");
  }
  try {
    const binary = resolve(import.meta.dir, "../dist/die");
    const launch = ["env", "HOME=" + home, "DIE_SUBAGENT_DEPTH=0", "DIE_CODING_AGENT_DIR=" + join(home, ".die", "agent"),
      "OPENAI_API_KEY=offline-test-placeholder", binary, "--offline", "--no-session", "--provider", "openai", "--model", "gpt-4o"].map(quote).join(" ");
    expect((await tmux("-f", resolve(import.meta.dir, "../scripts/tmux.conf"), "new-session", "-d", "-s", "mode", "-x", "120", "-y", "40", "-c", home, launch)).code).toBe(0);
    await frameContaining("gpt-4o"); await Bun.sleep(1000);
    await command("/mode fast");
    const switched = await frameContaining("Main-agent mode: fast");
    expect(switched).toContain("mode: fast");
    expect(switched).toContain("model and thinking unchanged");
  } finally {
    await tmux("kill-server");
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);
