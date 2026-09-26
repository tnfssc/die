import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { run } from "./helpers";
import { waitForLiveTuiStartup } from "./live-tui-startup";

// Real source CLI and Pi renderer; fake only credentials/config and forbidden I/O.
for (const width of [80, 120])
  test("Live picker real terminal " + width + " columns", async () => {
    const home = await mkdtemp(join(tmpdir(), "die-picker-tui-"));
    const root = resolve(import.meta.dir, "..");
    const socket = "die-picker-" + process.pid + "-" + width;
    const tmux = (...args: string[]) =>
      run([Bun.which("tmux") ?? "/usr/bin/tmux", "-L", socket, "-f", join(home, "tmux.conf"), ...args]);
    const frame = async () => (await tmux("capture-pane", "-p", "-t", "picker")).stdout;
    const until = async (text: string) => {
      for (let n = 0; n < 100; n++) {
        const value = await frame();
        if (value.includes(text)) return value;
        await Bun.sleep(80);
      }
      throw new Error("Missing " + text + " in actual terminal:\n" + (await frame()));
    };
    const send = async (text: string, expected: string) => {
      await tmux("send-keys", "-t", "picker", "-l", text);
      await Bun.sleep(120);
      await tmux("send-keys", "-t", "picker", "Enter");
      await Bun.sleep(250);
      if (!(await frame()).includes(expected)) await tmux("send-keys", "-t", "picker", "Enter");
    };
    const quote = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'";
    try {
      const { version } = await Bun.file(join(root, "package.json")).json();
      const themeDir = join(home, ".die/runtime", version, "dist/modes/interactive");
      await mkdir(themeDir, { recursive: true });
      await symlink(join(home, ".die/runtime", version, "theme"), join(themeDir, "theme"));
      const launch = [
        "env",
        "HOME=" + home,
        "PI_OFFLINE=1",
        "DIE_SUBAGENT_DEPTH=0",
        "OPENAI_API_KEY=offline-placeholder",
        process.execPath,
        join(root, "src/cli.ts"),
        "--offline",
        "--no-session",
        "--no-extensions",
        "-e",
        join(root, "tests/fixtures/live-picker-tui.ts"),
        "--provider",
        "openai",
        "--model",
        "gpt-4o",
      ]
        .map(quote)
        .join(" ");
      await writeFile(
        join(home, "tmux.conf"),
        (await readFile(join(root, "scripts/tmux.conf"), "utf8")) + "\nset -g default-shell /bin/sh\n",
      );
      expect(
        (await tmux("new-session", "-d", "-s", "picker", "-x", String(width), "-y", "40", "-c", root, launch)).code,
      ).toBe(0);
      await waitForLiveTuiStartup(frame, (key) => tmux("send-keys", "-t", "picker", key), "PICKER FIXTURE LOADED");
      await send("/livepicker model", "Live voice model");
      const rendered = await until("gpt-live-1");
      for (const label of [
        "gemini-3.8-live · Google Gemini · API key needed (OAuth) (selected)",
        "gemini-3.8-live-extended-thinking · Google Gemini · API key needed (OAuth)",
        "gpt-realtime-2.1 · OpenAI · key configured",
        "gpt-realtime-2.1-mini · OpenAI · key configured",
        "gpt-live-1 · OpenAI · key configured",
      ])
        expect(rendered).toContain(label);
      expect(rendered).toContain("Live voice model");
      expect(rendered).not.toContain("/questions unavailable");
      console.log("PICKER " + width + " cols\n" + rendered);
      for (let i = 0; i < 4; i++) await tmux("send-keys", "-t", "picker", "Down");
      await tmux("send-keys", "-t", "picker", "Enter");
      await until("Live voice: OpenAI · gpt-live-1");
      await send("/livepicker model", "Live voice model");
      const reselection = await until("gpt-live-1 · OpenAI · key configured (selected)");
      expect(reselection).toContain("gemini-3.8-live-extended-thinking · Google Gemini · API key needed (OAuth)");
      console.log("RESELECTED " + width + " cols\n" + reselection);
      await tmux("send-keys", "-t", "picker", "Escape");
      await Bun.sleep(500);
      await send("/livepicker provider", "Configure Live provider credentials");
      const provider = await until("Configure Live provider credentials");
      expect(provider).toContain("Google Gemini");
      expect(provider).toContain("OpenAI");
      console.log("PROVIDER " + width + " cols\n" + provider);
      await tmux("send-keys", "-t", "picker", "Down");
      await tmux("send-keys", "-t", "picker", "Enter");
      const setup = await until("OpenAI API key configured");
      expect(setup).toContain("Done");
      expect(setup).not.toContain("Start voice");
      console.log("SETUP " + width + " cols\n" + setup);
      await tmux("send-keys", "-t", "picker", "Enter"); // Done, never starts voice
      await until("");
      await send("/livepicker status", "Live off");
      const status = await until("Live off · OpenAI voice model gpt-live-1");
      expect(status).not.toContain("Live listening");
      console.log("STATUS " + width + " cols\n" + status);
    } finally {
      await tmux("kill-server");
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);
