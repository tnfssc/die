import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { prepareAgentSession } from "../src/tasks/agent-session";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

test("real TUI /ps selects live jobs and only stops the confirmed target", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-ps-tui-")),
    agentDir = join(home, ".die", "agent");
  await mkdir(agentDir, { recursive: true });
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests++;
      await request.json();
      const first = requests === 1;
      const delta = first
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "fixture_call",
                type: "function",
                function: {
                  name: "execute",
                  arguments: JSON.stringify({
                    code: `const a=await shell("sh -c 'for i in 1 2 3 4 5; do echo ALPHA-$i; sleep 1; done'",{waitSeconds:0}); const b=await shell("sh -c 'while :; do echo BETA-live; sleep 1; done'",{waitSeconds:0}); console.log(a.id,b.id)`,
                  }),
                },
              },
            ],
          }
        : { role: "assistant", content: "FIXTURE_READY" };
      const finish = first ? "tool_calls" : "stop",
        model = "fixture-model",
        created = Math.floor(Date.now() / 1000);
      const events = [
        {
          id: "fixture",
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: null }],
        },
        {
          id: "fixture",
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: finish }],
        },
      ];
      return new Response(
        events.map((value) => "data: " + JSON.stringify(value) + "\n\n").join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          baseUrl: "http://127.0.0.1:" + server.port + "/v1",
          api: "openai-completions",
          apiKey: "fixture",
          models: [{ id: "fixture-model", name: "fixture", contextWindow: 32000, maxTokens: 1000 }],
        },
      },
    }),
  );
  // This extension is a controlled, deliberately slow startup prerequisite. Its
  // registration is not itself readiness: the harmless command handshake below
  // proves that the normal submit handler actually accepts extension commands.
  const readinessMarker = join(home, "startup-readiness.marker");
  const readinessExtension = join(home, "startup-readiness.ts");
  await writeFile(
    readinessExtension,
    `export default async function (pi) {
  await new Promise((resolve) => setTimeout(resolve, 5500));
  pi.registerCommand("die-test-ready", {
    description: "TUI startup handshake",
    handler: async (_args, ctx) => ctx.ui.notify("DIE_TEST_READY", "info"),
  });
  await Bun.write(${JSON.stringify(readinessMarker)}, "registered");
}`,
  );
  const socket = "die-ps-" + process.pid + "-" + Date.now(),
    name = "ps";
  const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args]);
  const quote = (v: string) => "'" + v.replaceAll("'", "'\''") + "'";
  const capture = async () => (await tmux("capture-pane", "-p", "-t", name)).stdout;
  try {
    const binary = resolve(import.meta.dir, "../dist/die"),
      launch = [
        "env",
        "HOME=" + home,
        "DIE_CODING_AGENT_DIR=" + agentDir,
        binary,
        "--no-session",
        "--provider",
        "fixture",
        "--model",
        "fixture-model",
        "--extension",
        readinessExtension,
      ]
        .map(quote)
        .join(" ");
    expect((await tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30", "-c", home, launch)).code).toBe(0);
    let frame = "";
    const startupDeadline = Date.now() + 30_000;
    while (Date.now() < startupDeadline) {
      frame = await capture();
      if (frame.includes("fixture-model")) break;
      await Bun.sleep(50);
    }
    expect(frame).toContain("fixture-model");

    // Do not use handleStartupSubmit's status as readiness: the SDK only sets
    // that status *after* a premature submit. The fixture's explicit marker is
    // written after its command is registered. Only its UI response below proves
    // that managed-tool setup and the editor submit-handler transition finished.
    while (Date.now() < startupDeadline) {
      if (await Bun.file(readinessMarker).exists()) break;
      await Bun.sleep(50);
    }
    expect(await Bun.file(readinessMarker).exists()).toBe(true);
    await tmux("send-keys", "-t", name, "-l", "/die-test-ready");
    // This is a harmless command probe, not a prompt: retrying it cannot start
    // another job. It is complete only when the real submit handler accepts it.
    while (Date.now() < startupDeadline) {
      await tmux("send-keys", "-t", name, "Enter");
      frame = await capture();
      if (frame.includes("DIE_TEST_READY")) break;
      await Bun.sleep(50);
    }
    expect(frame).toContain("DIE_TEST_READY");
    // The readiness probe is not an LLM turn and must not create duplicate work.
    expect(requests).toBe(0);
    await tmux("send-keys", "-t", name, "-l", "start");
    await tmux("send-keys", "-t", name, "Enter");
    for (let i = 0; i < 120; i++) {
      frame = await capture();
      if (frame.includes("FIXTURE_READY")) break;
      await Bun.sleep(50);
    }
    expect(frame).toContain("FIXTURE_READY");
    await tmux("send-keys", "-t", name, "-l", "/ps");
    await tmux("send-keys", "-t", name, "Enter");
    for (let i = 0; i < 100; i++) {
      frame = await capture();
      if (frame.includes("ALPHA") && frame.includes("BETA")) break;
      await Bun.sleep(50);
    }
    expect(frame).toContain("ALPHA");
    expect(frame).toContain("BETA");
    await tmux("send-keys", "-t", name, "Enter");
    await Bun.sleep(200);
    frame = await capture();
    expect(frame).toContain("Inspect task_");
    expect(frame).toContain("ALPHA");
    await tmux("send-keys", "-t", name, "-l", "i");
    await Bun.sleep(200);
    frame = await capture();
    expect(frame).toContain("Running jobs");
    expect(frame).not.toContain("Inspect task_");
    await tmux("send-keys", "-t", name, "Down");
    await Bun.sleep(300);
    frame = await capture();
    expect(frame).toContain("BETA-live");
    await tmux("send-keys", "-t", name, "x");
    await Bun.sleep(100);
    frame = await capture();
    expect(frame).toContain("Stop task_");
    expect(frame).toContain("BETA");
    const stoppedTaskId = frame.match(/Stop (task_\w+)/)?.[1];
    expect(stoppedTaskId).toBeDefined();
    await tmux("send-keys", "-t", name, "y");
    await Bun.sleep(700);
    frame = await capture();
    expect(frame).toContain("✗ " + stoppedTaskId + " failed");
    expect(frame.slice(frame.lastIndexOf("Running jobs"))).toContain("ALPHA");
    expect(frame.slice(frame.lastIndexOf("Running jobs"))).not.toContain("BETA");
    await tmux("send-keys", "-t", name, "Escape");
    await Bun.sleep(600);
    frame = await capture();
    expect(frame).not.toContain("Running jobs");
  } finally {
    server.stop(true);
    await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
    await rm(home, { recursive: true, force: true });
  }
}, 20000);

test("real TUI /resume selects a durable child and requires explicit confirmation", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-resume-tui-")),
    sessions = join(home, "sessions");
  const root = SessionManager.create(home, sessions),
    rootFile = root.getSessionFile()!;
  const child = await prepareAgentSession(home, sessions, {
    type: "fast",
    model: "p/model",
    depth: 1,
    parentSessionFile: rootFile,
  });
  const socket = "die-resume-" + process.pid + "-" + Date.now(),
    name = "resume";
  const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args]);
  const quote = (v: string) => "'" + v.replaceAll("'", "'\''") + "'";
  const capture = async () => (await tmux("capture-pane", "-p", "-t", name)).stdout;
  try {
    const binary = resolve(import.meta.dir, "../dist/die");
    const launch = [
      "env",
      "HOME=" + home,
      "DIE_CODING_AGENT_DIR=" + join(home, ".die", "agent"),
      binary,
      "--offline",
      "--session",
      rootFile,
    ]
      .map(quote)
      .join(" ");
    expect((await tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30", "-c", home, launch)).code).toBe(0);
    let frame = "";
    for (let i = 0; i < 100; i++) {
      frame = await capture();
      if (frame.includes("/model")) break;
      await Bun.sleep(50);
    }
    await tmux("send-keys", "-t", name, "-l", "/resume");
    await tmux("send-keys", "-t", name, "Enter");
    for (let i = 0; i < 100; i++) {
      frame = await capture();
      if (frame.includes("worker") && frame.includes("fast")) break;
      await Bun.sleep(50);
    }
    expect(frame).toContain("worker");
    expect(frame).toContain("fast");
    await tmux("send-keys", "-t", name, "Enter");
    for (let i = 0; i < 100; i++) {
      frame = await capture();
      if (frame.includes("Enter worker child (fast) session?")) break;
      await Bun.sleep(50);
    }
    expect(frame).toContain("Enter worker child (fast) session?");
    expect(frame).toContain(child.id);
    await tmux("send-keys", "-t", name, "Down", "Enter");
    await Bun.sleep(600);
    frame = await capture();
    expect(frame).not.toContain("Enter worker child (fast) session?");
  } finally {
    await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
    await rm(home, { recursive: true, force: true });
  }
}, 20000);
