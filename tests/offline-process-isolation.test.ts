import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import net, { type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

test("test TUI processes cannot use an inherited Herdr pane identity", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-offline-isolation-"));
  const herdrSocket = join(home, "recording.sock");
  const paneId = "real-looking-host-pane";
  const requests: Array<{ method?: string; params?: { pane_id?: string } }> = [];
  const connections = new Set<Socket>();
  const server = net.createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString();
      for (let newline = input.indexOf("\n"); newline >= 0; newline = input.indexOf("\n")) {
        requests.push(JSON.parse(input.slice(0, newline)));
        input = input.slice(newline + 1);
        socket.write('{"ok":true}\n');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(herdrSocket, resolve);
  });

  const saved = {
    HERDR_ENV: process.env.HERDR_ENV,
    HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH,
    HERDR_PANE_ID: process.env.HERDR_PANE_ID,
  };
  process.env.HERDR_ENV = "1";
  process.env.HERDR_SOCKET_PATH = herdrSocket;
  process.env.HERDR_PANE_ID = paneId;

  const tmuxSocket = `die-offline-isolation-${process.pid}-${Date.now()}`;
  const tmux = (...args: string[]) => run(["tmux", "-L", tmuxSocket, ...args]);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  try {
    const launch = [
      "env",
      "HOME=" + home,
      "DIE_SUBAGENT_DEPTH=0",
      "DIE_CODING_AGENT_DIR=" + join(home, ".die", "agent"),
      "OPENAI_API_KEY=offline-test-placeholder",
      resolve(import.meta.dir, "../dist/die"),
      "--offline",
      "--no-session",
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(quote)
      .join(" ");
    expect(
      (
        await tmux(
          "-f",
          resolve(import.meta.dir, "../scripts/tmux.conf"),
          "new-session",
          "-d",
          "-s",
          "isolation",
          "-x",
          "100",
          "-y",
          "30",
          "-c",
          home,
          launch,
        )
      ).code,
    ).toBe(0);

    let frame = "";
    for (let attempt = 0; attempt < 80; attempt++) {
      frame = (await tmux("capture-pane", "-p", "-t", "isolation")).stdout;
      if (frame.includes("gpt-4o")) break;
      await Bun.sleep(50);
    }
    expect(frame).toContain("gpt-4o");
    await tmux("kill-server");
    await Bun.sleep(400);

    expect(requests).toEqual([]);
  } finally {
    await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);
