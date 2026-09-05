import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { run } from "./helpers";

const enabled = process.env.DIE_RUN_LLM_TESTS === "1";
test.skipIf(!enabled)(
  "Escape cancels execute waiting while its managed job survives and resumes",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-interrupt-ux-"));
    const socket = "die-interrupt-ux-" + process.pid + "-" + Date.now();
    const tmux = (...args: string[]) =>
      run(["tmux", "-L", socket, "-f", resolve(import.meta.dir, "../scripts/tmux.conf"), ...args]);
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    const file = join(dir, "session.jsonl");
    const entries = async () =>
      (await readFile(file, "utf8").catch(() => "")).split("\n").flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    const text = (e: any) =>
      (e.message?.content ?? [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n");
    const until = async (check: () => Promise<boolean>, timeout = 30000) => {
      const deadline = Date.now() + timeout;
      while (!(await check())) {
        if (Date.now() >= deadline) throw new Error("Interruption probe timed out");
        await Bun.sleep(50);
      }
    };
    const evidence: any = {};
    try {
      await writeFile(
        join(dir, "slow.sh"),
        "#!/bin/sh\ndate +%s%3N > started\nsleep 12\ndate +%s%3N > finished\nprintf 'INTERRUPT_JOB_OK\\n'\n",
        { mode: 0o755 },
      );
      const launch = [
        "env",
        "DIE_SUBAGENT_DEPTH=0",
        "DIE_SUBAGENT_TYPE=",
        resolve(import.meta.dir, "../dist/die"),
        "--session",
        file,
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-luna",
        "--thinking",
        process.env.DIE_UX_THINKING ?? "minimal",
      ]
        .map(quote)
        .join(" ");
      expect(
        (await tmux("new-session", "-d", "-s", "interrupt", "-x", "120", "-y", "35", "-c", dir, launch)).code,
      ).toBe(0);
      await Bun.sleep(750);
      await tmux(
        "send-keys",
        "-t",
        "interrupt",
        "-l",
        "This is an interruption test. I explicitly want a blocking wait: use execute to run console.log(await shell('./slow.sh', {waitSeconds:60, timeoutSeconds:60})). Report the actual result when it arrives.",
      );
      await tmux("send-keys", "-t", "interrupt", "Enter");
      await until(() => Bun.file(join(dir, "started")).exists());
      evidence.escapeAt = Date.now();
      await tmux("send-keys", "-t", "interrupt", "Escape");
      await until(
        async () =>
          (await entries()).some(
            (e) => e.message?.role === "toolResult" && e.message.isError && /cancel|abort/i.test(text(e)),
          ),
        5000,
      );
      evidence.executeCancelledAt = Date.now();
      expect(await Bun.file(join(dir, "finished")).exists()).toBe(false);
      await tmux("send-keys", "-t", "interrupt", "-l", "What is 6 times 7? Leave the managed job running.");
      await tmux("send-keys", "-t", "interrupt", "Enter");
      await until(
        async () => (await entries()).some((e) => e.message?.role === "assistant" && /\b42\b/.test(text(e))),
        10000,
      );
      evidence.answerAt = Date.now();
      expect(await Bun.file(join(dir, "finished")).exists()).toBe(false);
      await until(async () => (await entries()).some((e) => e.customType === "task-complete"), 20000);
      const all = await entries();
      const completions = all.filter((e) => e.customType === "task-complete");
      expect(completions).toHaveLength(1);
      expect(completions[0].content).toContain("INTERRUPT_JOB_OK");
      evidence.completionAt = Date.parse(completions[0].timestamp);
      await until(
        async () =>
          (await entries()).some(
            (e) =>
              e.message?.role === "assistant" &&
              e.message.stopReason === "stop" &&
              Date.parse(e.timestamp) > evidence.completionAt &&
              text(e).includes("INTERRUPT_JOB_OK"),
          ),
        15000,
      );
      evidence.resumedAt = Date.now();
      evidence.pass = true;
    } finally {
      await tmux("kill-server");
      const artifactDir = resolve(import.meta.dir, "../artifacts/ux");
      await mkdir(artifactDir, { recursive: true });
      await writeFile(join(artifactDir, "interrupt-" + Date.now() + ".json"), JSON.stringify(evidence, null, 2));
      await rm(dir, { recursive: true, force: true });
    }
  },
  65000,
);
