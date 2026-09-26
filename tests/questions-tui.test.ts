import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { QuestionService } from "../src/questions/service";
import { run } from "./helpers";
const hasTmux = (await run(["sh", "-c", "command -v tmux >/dev/null"])).code === 0;

test.skipIf(!hasTmux)(
  "real TUI keeps questions near composer after progress, cancellation and reload",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "die-questions-tui-"));
    const socket = "die-questions-" + process.pid + "-" + Date.now(),
      name = "questions";
    const seed = SessionManager.create(home, join(home, "sessions"));
    seed.appendCustomEntry("question-test", { seed: true });
    const file = seed.getSessionFile()!;
    const service = new QuestionService();
    const ctx = { sessionManager: seed };
    const quote = (v: string) => "'" + v.replaceAll("'", "'\''") + "'";
    const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args]);
    const frame = async () => (await tmux("capture-pane", "-p", "-t", name)).stdout;
    const send = async (text: string) => {
      await tmux("send-keys", "-t", name, "-l", text);
      await tmux("send-keys", "-t", name, "Enter");
    };
    const until = async (text: string) => {
      let value = "";
      for (let i = 0; i < 100; i++) {
        value = await frame();
        if (value.includes(text)) return value;
        await Bun.sleep(50);
      }
      throw new Error("Missing " + text + "\n" + value);
    };
    try {
      await writeFile(file, [seed.getHeader(), ...seed.getEntries()].map((v) => JSON.stringify(v)).join("\n") + "\n");
      const q = await service.ask(ctx, {
        text: "Where is the crackle?",
        choices: ["Playback", "Recording", "Both"],
        requester: "Audio diagnosis",
      });
      await service.block(ctx, {
        id: q.id,
        owner: q.owner,
        version: q.version,
        checkpoint: "Need the next audio test",
        foreground: true,
      });
      const second = await service.ask(ctx, { text: "Second independent question?" });
      const fixture = join(home, "fixture.ts");
      await writeFile(
        fixture,
        'export default function(pi) { pi.registerCommand("qprogress", {description:"test", handler:async()=>{ pi.sendMessage({customType:"question-test-progress",display:true,content:Array.from({length:50},(_,i)=>"Independent progress "+i).join("\\n")+"\\nIndependent work complete"},{triggerTurn:false}); }}); }',
      );
      const launch = [
        "env",
        "-u",
        "DIE_SUBAGENT_DEPTH",
        "-u",
        "DIE_SUBAGENT_TYPE",
        "HOME=" + home,
        "OPENAI_API_KEY=offline-test-placeholder",
        resolve(import.meta.dir, "../dist/die"),
        "--offline",
        "--no-approve",
        "--session",
        file,
        "--provider",
        "openai",
        "--model",
        "gpt-4o",
        "--extension",
        fixture,
      ]
        .map(quote)
        .join(" ");
      expect((await tmux("new-session", "-d", "-s", name, "-x", "120", "-y", "35", "-c", home, launch)).code).toBe(0);
      await until("2 /questions");
      await send("/qprogress");
      expect(await until("Independent work complete")).toContain("2 /questions");
      await send("/questions detail " + q.id);
      const detailFrame = await until("Audio diagnosis");
      expect(detailFrame).toContain("Need the next audio test");
      expect(detailFrame).toContain(q.id.slice(0, 10) + " [pending");
      expect(detailFrame).not.toContain(q.id + " [pending");
      if (process.env.DIE_QUESTIONS_FRAME) await writeFile(process.env.DIE_QUESTIONS_FRAME, detailFrame);
      await send("/questions cancel " + second.id);
      await until("1 /questions");
      await tmux("kill-session", "-t", name);
      expect((await tmux("new-session", "-d", "-s", name, "-x", "120", "-y", "35", "-c", home, launch)).code).toBe(0);
      expect(await until("1 /questions")).toContain("waiting");
      await send("/questions detail " + q.id.slice(0, 10));
      const resumedDetail = await until("Audio diagnosis");
      expect(resumedDetail).toContain(q.id.slice(0, 10) + " [pending");
      expect(resumedDetail).not.toContain(q.id + " [pending");
      expect(service.get(ctx, q.id).status).toBe("pending");
      expect(service.get(ctx, second.id).status).toBe("cancelled");
    } finally {
      await tmux("kill-server").catch(() => {});
      await rm(home, { recursive: true, force: true });
    }
  },
  20000,
);
