import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";
import { waitForLiveTuiStartup } from "./live-tui-startup";

// Actual Pi interactive renderer in a tmux PTY, with a fake GPT stream and fake audio.
test("GPT streaming keeps passive JSON in history but renders only the bounded Live transcript widget", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-gpt-tui-"));
  const socket = "die-gpt-tui-" + process.pid + "-" + Date.now();
  const root = resolve(import.meta.dir, "..");
  const tmux = (...args: string[]) => run(["tmux", "-L", socket, "-f", join(root, "scripts/tmux.conf"), ...args]);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const frame = async () => (await tmux("capture-pane", "-p", "-S", "-", "-t", "gpt")).stdout;
  const until = async (texts: string[]) => {
    for (let n = 0; n < 80; n++) {
      const value = await frame();
      if (texts.every((text) => value.includes(text))) return value;
      await Bun.sleep(100);
    }
    throw new Error("No " + texts.join(", ") + " in actual terminal:\n" + (await frame()));
  };
  try {
    const { version } = await Bun.file(join(root, "package.json")).json();
    const themeDir = join(dir, ".die/runtime", version, "dist/modes/interactive");
    await mkdir(themeDir, { recursive: true });
    // Source CLI materializes theme assets at runtimeRoot/theme, while the SDK source
    // resolves dist/modes/interactive/theme. This link is confined to the test HOME.
    await symlink(join(dir, ".die/runtime", version, "theme"), join(themeDir, "theme"));
    const launch = [
      "env",
      "HOME=" + dir,
      "PI_OFFLINE=1",
      "DIE_SUBAGENT_DEPTH=0",
      "OPENAI_API_KEY=offline-placeholder",
      process.execPath,
      join(root, "src/cli.ts"),
      "--offline",
      "--no-session",
      "--no-extensions",
      "-e",
      join(root, "tests/fixtures/live-gpt-tui.ts"),
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(quote)
      .join(" ");
    expect((await tmux("new-session", "-d", "-s", "gpt", "-x", "120", "-y", "40", "-c", root, launch)).code).toBe(0);
    await waitForLiveTuiStartup(frame, (key) => tmux("send-keys", "-t", "gpt", key), "GPT FIXTURE LOADED");
    await tmux("send-keys", "-t", "gpt", "-l", "/gptflood start");
    await Bun.sleep(120);
    await tmux("send-keys", "-t", "gpt", "Enter"); // completion may consume the first Enter
    await Bun.sleep(150);
    await tmux("send-keys", "-t", "gpt", "Enter");
    const rendered = await until(["delta23", "You: delta0 delta1", "Voice: provisional voice reply", "Live listening"]);
    expect(rendered).toContain("You: delta0 delta1");
    expect(rendered).toContain("Voice: provisional voice reply");
    expect(rendered).toContain("Live listening");
    expect(rendered).not.toContain("[live-transcript]");
    expect(rendered).not.toContain('"gpt_live_provisional"');
  } finally {
    await tmux("kill-server");
    await rm(dir, { recursive: true, force: true });
  }
}, 25_000);
