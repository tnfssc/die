import { yieldedEntries } from "./turn-boundaries";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

const enabled = process.env.DIE_RUN_LLM_TESTS === "1";
const binary = resolve(import.meta.dir, "../dist/die");
const artifactsRoot = resolve(import.meta.dir, "../artifacts/tui");

type Entry = Record<string, any>;
type Evidence = {
  startedAt: number;
  events: Array<{ name: string; at: number; detail?: unknown }>;
  toolArgs: Array<{ at: string; code: string }>;
  frameExcerpts: Array<{ at: number; lines: string[] }>;
  classification?: string;
};

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const text = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter((part) => part?.type === "text")
        .map((part) => part.text ?? "")
        .join("\n")
    : typeof content === "string"
      ? content
      : "";
const entryMs = (entry: Entry): number => Date.parse(entry.timestamp);

async function entries(path: string): Promise<Entry[]> {
  try {
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function executeCalls(all: Entry[]) {
  return all.flatMap((entry) =>
    entry.type === "message" && entry.message?.role === "assistant"
      ? (entry.message.content ?? [])
          .filter((part: any) => part.type === "toolCall" && part.name === "execute")
          .map((part: any) => ({ entry, part, code: String(part.arguments?.code ?? "") }))
      : [],
  );
}

function executeResults(all: Entry[]) {
  return all.filter(
    (entry) => entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolName === "execute",
  );
}

function safeSession(all: Entry[]) {
  return all.map((entry) => {
    if (entry.type === "message" && entry.message?.role === "assistant")
      return {
        type: entry.type,
        timestamp: entry.timestamp,
        role: "assistant",
        stopReason: entry.message.stopReason,
        content: (entry.message.content ?? []).flatMap((part: any) =>
          part.type === "toolCall"
            ? [{ type: "toolCall", name: part.name, arguments: part.arguments }]
            : part.type === "text"
              ? [{ type: "text", text: part.text }]
              : [],
        ),
      };
    if (entry.type === "message" && entry.message?.role === "toolResult")
      return {
        type: entry.type,
        timestamp: entry.timestamp,
        role: "toolResult",
        toolName: entry.message.toolName,
        isError: entry.message.isError,
        text: text(entry.message.content),
      };
    if (entry.customType === "task-complete")
      return {
        type: entry.type,
        timestamp: entry.timestamp,
        customType: entry.customType,
        content: entry.content,
      };
    if (entry.type === "message" && entry.message?.role === "user")
      return {
        type: entry.type,
        timestamp: entry.timestamp,
        role: "user",
        text: text(entry.message.content),
      };
    return { type: entry.type, timestamp: entry.timestamp, customType: entry.customType };
  });
}

test.skipIf(!enabled)(
  "real TUI backgrounds execute, stays responsive, and automatically resumes once",
  async () => {
    const fixture = await mkdtemp(join(tmpdir(), "die-background-ux-"));
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const artifactDir = join(artifactsRoot, "background-ux-" + stamp);
    const sessionFile = join(fixture, "session.jsonl");
    const socket = "die-background-ux-" + process.pid + "-" + Date.now();
    const name = "background-ux";
    const evidence: Evidence = { startedAt: Date.now(), events: [], toolArgs: [], frameExcerpts: [] };
    const tmux = (...args: string[]) =>
      run(["tmux", "-L", socket, "-f", resolve(import.meta.dir, "../scripts/tmux.conf"), ...args]);
    const capture = async () => (await tmux("capture-pane", "-p", "-t", name + ":0.0")).stdout;
    const rememberFrame = async (label: string) => {
      const at = Date.now();
      const frame = await capture();
      const lines = frame
        .split("\n")
        .filter((line) => /slow-check|INDEPENDENT_NOTE_ALPHA|17 \+ 25|42|running|completed|passed/i.test(line));
      evidence.frameExcerpts.push({ at, lines: ["[" + label + "]", ...lines] });
      return frame;
    };
    const send = async (value: string) => {
      expect((await tmux("send-keys", "-t", name + ":0.0", "-l", value)).code).toBe(0);
      expect((await tmux("send-keys", "-t", name + ":0.0", "Enter")).code).toBe(0);
    };
    let failure: Error | undefined;
    let finalEntries: Entry[] = [];
    try {
      await writeFile(join(fixture, "independent-notes.txt"), "INDEPENDENT_NOTE_ALPHA: release lane is green.\n");
      await writeFile(
        join(fixture, "slow-check.sh"),
        "#!/bin/sh\nset -eu\nsleep 25\nprintf 'SLOW_CHECK_OK\n' > slow-result.txt\ndate +%s%3N > slow-finished-ms.txt\nprintf 'SLOW_CHECK_OK\n'\n",
        { mode: 0o755 },
      );

      const prompt =
        "Validate this fixture project: run ./slow-check.sh (it takes about 25 seconds), and while it is running inspect the independent local file independent-notes.txt. Report the check result and the note contents. Be efficient and leave no child processes behind.";
      const launch = [
        "env",
        "DIE_SUBAGENT_DEPTH=0",
        "DIE_SUBAGENT_TYPE=",
        binary,
        "--session",
        sessionFile,
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-luna",
        "--thinking",
        process.env.DIE_UX_THINKING ?? "minimal",
      ]
        .map(quote)
        .join(" ");
      const started = await tmux("new-session", "-d", "-s", name, "-x", "120", "-y", "40", "-c", fixture, launch);
      if (started.code !== 0) throw new Error("RUNTIME_UX: tmux launch failed: " + started.stderr);
      await Bun.sleep(750);
      await send(prompt);
      evidence.events.push({ name: "prompt-submitted", at: Date.now() });

      // Wait for a completed execute invocation that launched a background shell job,
      // useful note inspection, and an assistant stop while the fixture is still running.
      let launchResult: Entry | undefined;
      let yieldEntry: Entry | undefined;
      const launchDeadline = Date.now() + 75_000;
      while (Date.now() < launchDeadline) {
        const all = await entries(sessionFile);
        const calls = executeCalls(all);
        const results = executeResults(all);
        launchResult = results.find(
          (entry) =>
            entry.message.details?.backgroundJobs?.length > 0 ||
            /background[\s\S]*true|status[\s\S]*running/i.test(text(entry.message.content)),
        );
        const launchAt = launchResult ? entryMs(launchResult) : Infinity;
        const usefulAt = results
          .filter((entry) => text(entry.message.content).includes("INDEPENDENT_NOTE_ALPHA"))
          .map(entryMs)
          .find((at) => at < Infinity);
        yieldEntry = yieldedEntries(all).find((entry) => entryMs(entry) >= Math.max(launchAt, usefulAt ?? Infinity));
        const unfinished = !(await Bun.file(join(fixture, "slow-finished-ms.txt")).exists());
        if (launchResult && usefulAt && yieldEntry && unfinished) break;
        if (!unfinished) break;
        await Bun.sleep(100);
      }
      finalEntries = await entries(sessionFile);
      evidence.toolArgs = executeCalls(finalEntries).map(({ entry, code }) => ({ at: entry.timestamp, code }));
      const apiError = finalEntries.some((entry) =>
        /rate.?limit|authentication|model.*error|overloaded/i.test(text(entry.message?.content)),
      );
      if (!launchResult)
        throw new Error(
          (apiError ? "MODEL_OR_PROVIDER_ERROR" : "MODEL_BEHAVIOR") + ": no observable background shell launch",
        );
      if (!yieldEntry)
        throw new Error("MODEL_BEHAVIOR: assistant did not yield after useful independent work while the job ran");
      if (await Bun.file(join(fixture, "slow-finished-ms.txt")).exists())
        throw new Error("MODEL_BEHAVIOR: natural-flow prerequisites were not observed before command completion");
      evidence.events.push({ name: "background-launch-result", at: entryMs(launchResult) });
      evidence.events.push({ name: "assistant-yield", at: entryMs(yieldEntry) });
      await rememberFrame("yield-before-arithmetic");

      const arithmetic = "While that check is still running, what is 17 + 25? Answer the arithmetic too.";
      const arithmeticSentAt = Date.now();
      await send(arithmetic);
      evidence.events.push({ name: "arithmetic-submitted", at: arithmeticSentAt });
      let responsiveAt = 0;
      const uiDeadline = Math.min(arithmeticSentAt + 5_000, evidence.startedAt + 90_000);
      while (Date.now() < uiDeadline && !(await Bun.file(join(fixture, "slow-finished-ms.txt")).exists())) {
        const frame = await capture();
        if (frame.includes("17 + 25")) {
          responsiveAt = Date.now();
          break;
        }
        await Bun.sleep(50);
      }
      if (!responsiveAt) throw new Error("RUNTIME_UX: arithmetic input was not rendered before background completion");
      evidence.events.push({
        name: "arithmetic-visible",
        at: responsiveAt,
        detail: { latencyMs: responsiveAt - arithmeticSentAt },
      });
      await rememberFrame("arithmetic-visible");

      const completionDeadline = Date.now() + 80_000;
      let finishedMs = 0;
      while (Date.now() < completionDeadline) {
        finalEntries = await entries(sessionFile);
        if (await Bun.file(join(fixture, "slow-finished-ms.txt")).exists())
          finishedMs = Number((await readFile(join(fixture, "slow-finished-ms.txt"), "utf8")).trim());
        const completions = finalEntries.filter((entry) => entry.customType === "task-complete");
        const completionAt = completions[0] ? entryMs(completions[0]) : Infinity;
        const resumed = finalEntries.find(
          (entry) =>
            entry.type === "message" &&
            entry.message?.role === "assistant" &&
            entry.message.stopReason === "stop" &&
            entryMs(entry) > completionAt &&
            /SLOW_CHECK_OK|INDEPENDENT_NOTE_ALPHA/i.test(text(entry.message.content)),
        );
        if (finishedMs && completions.length && resumed) break;
        await Bun.sleep(100);
      }
      finalEntries = await entries(sessionFile);
      const calls = executeCalls(finalEntries);
      evidence.toolArgs = calls.map(({ entry, code }) => ({ at: entry.timestamp, code }));
      const results = executeResults(finalEntries);
      const completions = finalEntries.filter((entry) => entry.customType === "task-complete");
      finishedMs = Number((await readFile(join(fixture, "slow-finished-ms.txt"), "utf8").catch(() => "0")).trim());
      const launchAt = entryMs(launchResult);
      const useful = results.find((entry) => text(entry.message.content).includes("INDEPENDENT_NOTE_ALPHA"));
      const completionAt = completions[0] ? entryMs(completions[0]) : Infinity;
      const resumed = finalEntries.find(
        (entry) =>
          entry.type === "message" &&
          entry.message?.role === "assistant" &&
          entry.message.stopReason === "stop" &&
          entryMs(entry) > completionAt &&
          /SLOW_CHECK_OK|INDEPENDENT_NOTE_ALPHA/i.test(text(entry.message.content)),
      );
      // An opportunistic snapshot within useful work is not a polling loop.
      // This healthy fixture has no fault to diagnose, so repeated status-only
      // calls are waiting rather than investigation.
      const waitingOnly = calls.filter(
        ({ code }) =>
          /jobs\s*\.\s*(list|inspect)/.test(code) && !/shell\s*\(|subagent\s*\(|Bun\.file|readFile|node:fs/.test(code),
      );
      const sleeping = waitingOnly.filter(({ code }) => /Bun\s*\.\s*sleep|setTimeout\s*\(/.test(code));
      const launchCall = calls.find(({ part }) => part.id === launchResult.message.toolCallId);
      const launchDurationMs = launchCall ? launchAt - entryMs(launchCall.entry) : Infinity;
      const arithmeticAnswer = finalEntries.some(
        (entry) =>
          entry.type === "message" &&
          entry.message?.role === "assistant" &&
          entryMs(entry) > arithmeticSentAt &&
          entryMs(entry) < finishedMs &&
          /\b42\b/.test(text(entry.message.content)),
      );

      if (!(finishedMs > launchAt))
        throw new Error("RUNTIME_UX: execute launch did not return before the command finished");
      if (!useful || !(entryMs(useful) < finishedMs))
        throw new Error("MODEL_BEHAVIOR: no useful independent file inspection before completion");
      if (!(entryMs(yieldEntry) < finishedMs))
        throw new Error("MODEL_BEHAVIOR: assistant did not yield before command completion");
      if (launchDurationMs > 3000)
        throw new Error("MODEL_BEHAVIOR: launch held execute open for " + launchDurationMs + "ms");
      if (waitingOnly.length > 1 || sleeping.length)
        throw new Error(
          "MODEL_BEHAVIOR: repeated waiting-only calls or sleeps: " + waitingOnly.map(({ code }) => code).join(" | "),
        );
      if (completions.length !== 1)
        throw new Error("RUNTIME_UX: expected exactly one automatic completion, got " + completions.length);
      if (!resumed)
        throw new Error("RUNTIME_UX: no automatic post-completion assistant continuation reported fixture results");
      if (!arithmeticAnswer)
        throw new Error(
          "MODEL_BEHAVIOR: assistant did not answer the arithmetic follow-up before the background command finished",
        );
      evidence.events.push({
        name: "launch-duration",
        at: launchAt,
        detail: { launchDurationMs, waitingOnlyCalls: waitingOnly.length },
      });
      evidence.events.push({ name: "fixture-finished", at: finishedMs });
      evidence.events.push({ name: "automatic-completion", at: completionAt });
      evidence.events.push({ name: "automatic-continuation", at: entryMs(resumed) });
      evidence.classification = "pass";
      await rememberFrame("final");
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      evidence.classification = failure.message.split(":", 1)[0];
      finalEntries = await entries(sessionFile);
      await rememberFrame("failure").catch(() => "");
    } finally {
      await mkdir(artifactDir, { recursive: true });
      await writeFile(join(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
      await writeFile(join(artifactDir, "session.sanitized.json"), JSON.stringify(safeSession(finalEntries), null, 2));
      await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
      await rm(fixture, { recursive: true, force: true });
    }
    if (failure) throw failure;
  },
  180_000,
);
