import { yieldedEntries } from "./turn-boundaries";
import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const enabled = process.env.DIE_RUN_LLM_TESTS === "1";
const binary = resolve(import.meta.dir, "../dist/die");

test.skipIf(!enabled)(
  "natural nested-agent workflow returns control before descendants finish",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "die-nested-ux-"));
    const sessionDir = join(directory, "sessions");
    const evidence: any[] = [];
    let child: ReturnType<typeof spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await mkdir(sessionDir);
      await writeFile(
        join(directory, "slow-check.ts"),
        'await Bun.write("check-start", String(Date.now())); await Bun.sleep(15000); await Bun.write("check-end", String(Date.now())); console.log("slow-check: PASS");',
      );
      await writeFile(join(directory, "config.json"), JSON.stringify({ name: "tiny-audit", retries: 3 }));
      await writeFile(
        join(directory, "README.md"),
        "This project validates a slow check and a three-retry configuration.\n",
      );
      child = spawn(
        binary,
        [
          "--provider",
          "openai-codex",
          "--model",
          "gpt-5.6-luna",
          "--thinking",
          process.env.DIE_UX_THINKING ?? "minimal",
          "--mode",
          "json",
          "--session",
          join(sessionDir, "parent.jsonl"),
          "-p",
          "Delegate to a separate orchestrator subagent, distinct from yourself. Have that subagent coordinate two fast worker subagents: one should run slow-check.ts with Bun and report its actual result, the other should review config.json. Meanwhile, read README.md yourself. Combine the outcomes when all the work is finished. Do not edit project files.",
        ],
        {
          cwd: directory,
          env: { ...process.env, DIE_SUBAGENT_DEPTH: "0", DIE_SUBAGENT_TYPE: "" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let pending = "",
        stderr = "";
      child.stdout!.on("data", (chunk) => {
        pending += chunk.toString();
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (["tool_execution_start", "tool_execution_end"].includes(event.type))
              evidence.push({ at: Date.now(), ...event });
            if (event.type === "agent_end") evidence.push({ at: Date.now(), type: event.type });
            if (event.type === "message_end" && event.message?.role === "assistant")
              evidence.push({
                at: Date.now(),
                type: "assistant",
                stopReason: event.message.stopReason,
                text: event.message.content
                  .filter((p: any) => p.type === "text")
                  .map((p: any) => p.text)
                  .join(""),
              });
          } catch {}
        }
      });
      child.stderr!.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      timer = setTimeout(() => child?.kill("SIGTERM"), 150000);
      const exitCode = await new Promise<number | null>((done, fail) => {
        child!.once("exit", done);
        child!.once("error", fail);
      });
      expect(exitCode).toBe(0);
      const sessions = [];
      for (const name of await readdir(sessionDir)) {
        if (!name.endsWith(".jsonl")) continue;
        const entries = (await readFile(join(sessionDir, name), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const metadata = entries.find((e) => e.type === "custom" && e.customType === "die-agent")?.data;
        const messages = entries.filter((e) => e.type === "message");
        const calls = messages.flatMap((e) =>
          e.message.role === "assistant"
            ? (e.message.content ?? [])
                .filter((p: any) => p.type === "toolCall")
                .map((p: any) => ({ timestamp: e.timestamp, id: p.id, code: p.arguments?.code }))
            : [],
        );
        const results = messages
          .filter((e) => e.message.role === "toolResult")
          .map((e) => ({
            timestamp: e.timestamp,
            id: e.message.toolCallId,
            stdout: e.message.details?.stdout,
            backgroundJobs: e.message.details?.backgroundJobs ?? [],
            isError: e.message.isError,
          }));
        const stops = yieldedEntries(messages).map((e) => ({ timestamp: e.timestamp }));
        const completions = entries
          .filter((e) => e.customType === "task-complete")
          .map((e) => ({ timestamp: e.timestamp, tasks: e.details?.tasks }));
        sessions.push({ name, metadata, calls, results, stops, completions });
      }
      const report = { evidence, sessions, stderr };
      const artifactDir = resolve(import.meta.dir, "../artifacts/ux");
      await mkdir(artifactDir, { recursive: true });
      const artifact = join(artifactDir, "nested-" + Date.now() + ".json");
      await writeFile(artifact, JSON.stringify(report, null, 2));
      console.log("Nested UX evidence:", artifact);
      expect(sessions.some((s) => s.metadata?.type === "orchestrator" && s.metadata.depth === 1)).toBe(true);
      expect(
        sessions.filter((s) => s.metadata?.depth === 2 && s.metadata.type === "fast").length,
      ).toBeGreaterThanOrEqual(2);
      const start = Number(await readFile(join(directory, "check-start"), "utf8"));
      const end = Number(await readFile(join(directory, "check-end"), "utf8"));
      const runner = sessions.find(
        (s) =>
          s.calls.some((c) => c.code?.includes("slow-check.ts") && c.code?.includes("shell(")) &&
          s.metadata?.depth === 2,
      );
      expect(runner).toBeDefined();
      const background = runner!.results.find((r) => r.backgroundJobs.length > 0);
      expect(background).toBeDefined();
      expect(Date.parse(background!.timestamp)).toBeLessThan(end);
      expect(Date.parse(background!.timestamp) - start).toBeLessThan(5000);
      const rootSession = sessions.find((s) => !s.metadata)!;
      expect(rootSession.results.some((r) => Date.parse(r.timestamp) < end)).toBe(true);
      expect(rootSession.stops.some((s) => Date.parse(s.timestamp) < end)).toBe(true);
      expect(runner!.stops.some((s) => Date.parse(s.timestamp) < end)).toBe(true);
      const orchestrator = sessions.find((s) => s.metadata?.type === "orchestrator")!;
      expect(orchestrator.completions).toHaveLength(2);
      expect(rootSession.completions).toHaveLength(1);
      expect(runner!.completions).toHaveLength(1);
      for (const session of sessions) {
        const waitingOnly = session.calls.filter(
          (c) =>
            /jobs\.(inspect|list)\(/.test(c.code ?? "") &&
            !/shell\s*\(|subagent\s*\(|Bun\.file|readFile|node:fs/.test(c.code ?? ""),
        );
        expect(waitingOnly.length).toBeLessThanOrEqual(1);
        expect(waitingOnly.map((c) => c.code).join("\n")).not.toMatch(/Bun\.sleep\(|setTimeout\(/);
      }
      expect(evidence.filter((e) => e.type === "assistant").at(-1)?.text).toContain("PASS");
      console.log(
        JSON.stringify({
          agents: sessions.filter((s) => s.metadata).length,
          checkDurationMs: end - start,
          leafLaunchReturnMs: Date.parse(background!.timestamp) - start,
        }),
      );
    } finally {
      if (timer) clearTimeout(timer);
      child?.kill("SIGTERM");
      await rm(directory, { recursive: true, force: true });
    }
  },
  170000,
);
