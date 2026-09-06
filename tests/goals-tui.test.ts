import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

const hasTmux = (await run(["sh", "-c", "command -v tmux >/dev/null"])).code === 0;

test.skipIf(!hasTmux)(
  "real TUI accepts /goal before the first ordinary turn",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "die-goal-tui-"));
    const socket = `die-goal-${process.pid}-${Date.now()}`;
    const name = "goal";
    const seed = SessionManager.create(home, join(home, "sessions"));
    const sessionFile = seed.getSessionFile()!;
    const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args]);
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    const capture = () => tmux("capture-pane", "-p", "-S", "-", "-t", name);

    try {
      await writeFile(sessionFile, JSON.stringify(seed.getHeader()) + "\n", { flag: "wx" });
      const launch = [
        "env",
        `HOME=${home}`,
        "OPENAI_API_KEY=offline-test-placeholder",
        resolve(import.meta.dir, "../dist/die"),
        "--offline",
        "--session",
        sessionFile,
        "--provider",
        "openai",
        "--model",
        "gpt-4o",
      ]
        .map(quote)
        .join(" ");
      expect((await tmux("new-session", "-d", "-s", name, "-x", "120", "-y", "35", "-c", home, launch)).code).toBe(0);

      // A painted footer is not a startup barrier: Pi can render it before
      // extension command bindings are ready. Probe the goal command itself and
      // proceed only after it has handled a slash command without starting an LLM turn.
      let frame = "";
      for (let attempt = 0; attempt < 100; attempt++) {
        await tmux("send-keys", "-t", name, "C-u");
        await tmux("send-keys", "-t", name, "-l", "/goal status");
        await tmux("send-keys", "-t", name, "Enter");
        await Bun.sleep(50);
        frame = (await capture()).stdout;
        if (frame.includes("No goal is set.")) break;
      }
      expect(frame).toContain("No goal is set.");
      const readyEntries = (await readFile(sessionFile, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(readyEntries.some((entry) => entry.type === "message")).toBe(false);

      await tmux("send-keys", "-t", name, "-l", "/goal set TUI objective --criteria persisted --constraints offline");
      await tmux("send-keys", "-t", name, "Enter");

      for (let attempt = 0; attempt < 100; attempt++) {
        frame = (await capture()).stdout;
        if (frame.includes("TUI objective") && frame.includes("Status: active")) break;
        await Bun.sleep(50);
      }
      expect(frame).toContain("TUI objective");
      expect(frame).toContain("Status: active");

      const entries = (await readFile(sessionFile, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const goal = entries.find((entry) => entry.customType === "die-goal");
      expect(goal.data.goal).toMatchObject({
        objective: "TUI objective",
        status: "active",
      });
    } finally {
      await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
      await rm(home, { recursive: true, force: true });
    }
  },
  15_000,
);
