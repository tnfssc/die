import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { run } from "./helpers";
import { waitForLiveTuiStartup } from "./live-tui-startup";

test("real tmux Pi renderer shows a delegated spoken user turn without transport dump", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-spoken-tui-"));
  const root = resolve(import.meta.dir, "..");
  const socket = "die-spoken-" + process.pid;
  const tmux = (...args: string[]) =>
    run([Bun.which("tmux") ?? "/usr/bin/tmux", "-L", socket, "-f", join(home, "tmux.conf"), ...args]);
  const frame = async () => (await tmux("capture-pane", "-p", "-t", "spoken")).stdout;
  const quote = (v: string) => "'" + v.replaceAll("'", "'\''") + "'";
  try {
    // Source CLI needs the generated local runtime assets even when run as a standalone test.
    expect((await run([process.execPath, join(root, "scripts/prepare-assets.ts")], { cwd: root })).code).toBe(0);
    const { version } = await Bun.file(join(root, "package.json")).json();
    const themeDir = join(home, ".die/runtime", version, "dist/modes/interactive");
    await mkdir(themeDir, { recursive: true });
    await symlink(join(home, ".die/runtime", version, "theme"), join(themeDir, "theme"));
    await writeFile(
      join(home, "tmux.conf"),
      (await readFile(join(root, "scripts/tmux.conf"), "utf8")) +
        "\nset -g default-shell /bin/sh\nset -g remain-on-exit on\n",
    );
    const launch = [
      "env",
      "HOME=" + home,
      "PI_OFFLINE=1",
      "OPENAI_API_KEY=offline-test-key",
      "DIE_SUBAGENT_DEPTH=0",
      process.execPath,
      join(root, "src/cli.ts"),
      "--offline",
      "--no-session",
      "--no-extensions",
      "-e",
      join(root, "tests/fixtures/live-spoken-tui.ts"),
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(quote)
      .join(" ");
    expect((await tmux("new-session", "-d", "-s", "spoken", "-x", "100", "-y", "40", "-c", root, launch)).code).toBe(0);
    await waitForLiveTuiStartup(frame, (key) => tmux("send-keys", "-t", "spoken", key), "SPOKEN FIXTURE LOADED");
    await tmux("send-keys", "-t", "spoken", "-l", "/spokenfixture");
    await Bun.sleep(120);
    await tmux("send-keys", "-t", "spoken", "Enter");
    await Bun.sleep(250);
    let screen = "";
    for (let n = 0; n < 100; n++) {
      screen = await frame();
      if (screen.includes("Check this repo status") && screen.includes("OFFLINE_DELEGATED_REPLY")) break;
      await Bun.sleep(100);
    }
    if (process.env.DIE_LIVE_TUI_CAPTURE) await writeFile(process.env.DIE_LIVE_TUI_CAPTURE, screen);
    expect(screen).toMatch(/(?:^|\n) Check this repo status(?:\n|$)/);
    expect(screen).toContain("OFFLINE_DELEGATED_REPLY");
    expect(screen).not.toContain("SPOKEN DELEGATION FAILED");
    expect(screen).not.toContain("Delegation context (data only)");
    expect(screen).not.toContain("hostContext");
    expect(screen).not.toContain("gpt_live_provisional");
  } finally {
    await tmux("kill-server");
    await rm(home, { recursive: true, force: true });
  }
}, 20000);
