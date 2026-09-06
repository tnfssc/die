import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { run } from "./helpers";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("real TUI shows one-line collapsed execute/task rows and expandable details at small width and on failure", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-preview-pty-"));
  const socket = "die-preview-" + process.pid + "-" + Date.now();
  const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args]);
  const key = (...keys: string[]) => tmux("send-keys", "-t", "preview", ...keys);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  async function frameContaining(text: string, history = false) {
    let frame = "";
    for (let attempt = 0; attempt < 80; attempt++) {
      frame = (await tmux("capture-pane", "-p", "-t", "preview", ...(history ? ["-S", "-"] : []))).stdout;
      if (frame.includes(text)) return frame;
      await Bun.sleep(50);
    }
    throw new Error("Missing " + text + " in frame:\n" + frame);
  }
  try {
    const session = SessionManager.create(home, join(home, "sessions"));
    session.appendMessage({ role: "user", content: "Preview fixture", timestamp: Date.now() });
    const appendTool = (id: string, code: string, text: string, details: object, isError: boolean) => {
      session.appendMessage({
        role: "assistant",
        content: [{ type: "toolCall", id, name: "execute", arguments: { code } }],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4o",
        usage,
        stopReason: "toolUse",
        timestamp: Date.now(),
      });
      session.appendMessage({
        role: "toolResult",
        toolCallId: id,
        toolName: "execute",
        content: [{ type: "text", text }],
        details,
        isError,
        timestamp: Date.now(),
      });
    };
    appendTool(
      "success-call",
      "// COMMAND_FIRST\n" + Array.from({ length: 12 }, (_, i) => "// COMMAND_HIDDEN_" + i).join("\n"),
      "Execution completed with exit code 0.\n\nstdout:\n" +
        Array.from({ length: 12 }, (_, i) => "OUTPUT_HIDDEN_" + i).join("\n"),
      {
        exitCode: 0,
        stdout: Array.from({ length: 12 }, (_, i) => "OUTPUT_HIDDEN_" + i).join("\n"),
        stderr: "",
        images: [],
      },
      false,
    );
    appendTool(
      "failure-call",
      "throw new Error('FAILURE_COMMAND_DETAIL')",
      "Execution failed with exit code 7.\n\nstderr:\nFAILURE_OUTPUT_DETAIL",
      { exitCode: 7, stdout: "", stderr: "FAILURE_OUTPUT_DETAIL", images: [] },
      true,
    );
    session.appendCustomMessageEntry(
      "task-complete",
      "1 asynchronous task completed.\ntask_fixture completed\nFinal output preview:\nTASK_OUTPUT_DETAIL",
      true,
      {
        tasks: [{ id: "task_fixture", status: "completed", exitCode: 0 }],
        attention: [],
        omittedTasks: 0,
        omittedAttention: 0,
      },
    );
    const binary = resolve(import.meta.dir, "../dist/die");
    const launch = [
      "env",
      "HOME=" + home,
      "DIE_CODING_AGENT_DIR=" + join(home, ".die", "agent"),
      "OPENAI_API_KEY=offline-test-placeholder",
      binary,
      "--offline",
      "--session",
      session.getSessionFile()!,
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(quote)
      .join(" ");
    expect((await tmux("new-session", "-d", "-s", "preview", "-x", "120", "-y", "40", "-c", home, launch)).code).toBe(
      0,
    );

    const compact = await frameContaining("Task complete");
    expect(compact).toContain("Execution completed");
    expect(compact).toContain("Execution failed");
    expect(compact).toContain("task_fixture completed exit 0");
    expect(compact).not.toContain("COMMAND_HIDDEN_5");
    expect(compact).not.toContain("OUTPUT_HIDDEN_5");
    expect(compact).not.toContain("FAILURE_OUTPUT_DETAIL");
    expect(compact).not.toContain("TASK_OUTPUT_DETAIL");
    // A settled tool is one combined renderer row, not separate call/result rows.
    expect(compact.split("\n").filter((line) => line.includes("Execution completed")).length).toBe(1);

    expect((await tmux("resize-window", "-t", "preview", "-x", "38", "-y", "40")).code).toBe(0);
    await Bun.sleep(300);
    const narrow = await frameContaining("Task complete");
    for (const line of narrow.split("\n")) expect([...line].length).toBeLessThanOrEqual(38);
    expect(narrow).not.toContain("OUTPUT_HIDDEN_5");

    await key("C-o");
    const expanded = await frameContaining("TASK_OUTPUT_DETAIL", true);
    expect(expanded).toContain("COMMAND_HIDDEN_5");
    expect(expanded).toContain("OUTPUT_HIDDEN_5");
    expect(expanded).toContain("FAILURE_COMMAND_DETAIL");
    expect(expanded).toContain("FAILURE_OUTPUT_DETAIL");
  } finally {
    await tmux("kill-server");
    await rm(home, { recursive: true, force: true });
  }
}, 15000);
