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
      ]
        .map(quote)
        .join(" ");
    expect((await tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30", "-c", home, launch)).code).toBe(0);
    let frame = "";
    for (let i = 0; i < 100; i++) {
      frame = await capture();
      if (frame.includes("fixture-model") && !frame.includes("Startup is still in progress")) break;
      await Bun.sleep(50);
    }
    await Bun.sleep(1000);
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
    await tmux("send-keys", "-t", name, "y");
    await Bun.sleep(700);
    frame = await capture();
    expect(frame).toContain("killed");
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
