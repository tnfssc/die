import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { join } from "node:path";

const fixture = join(import.meta.dir, "fixtures/web-voice-pipe-child.ts");
function frame(kind: number, bytes: Uint8Array) {
  const head = Buffer.alloc(5);
  head[0] = kind;
  head.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([head, bytes]);
}
function pipe() {
  const child = spawn(process.execPath, [fixture], {
    stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    env: { ...process.env, DIE_WEB_VOICE_FD: "3", DIE_WEB_VOICE_OUTPUT_FD: "4" },
  });
  let text = "",
    binary = Buffer.alloc(0),
    stderr = "";
  const events: any[] = [],
    frames: { kind: number; bytes: Buffer }[] = [];
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  child.stdout.on("data", (data) => {
    text += data;
    let i: number;
    while ((i = text.indexOf("\n")) >= 0) {
      events.push(JSON.parse(text.slice(0, i)));
      text = text.slice(i + 1);
    }
  });
  child.stdio[4]!.on("data", (chunk) => {
    binary = Buffer.concat([binary, chunk]);
    while (binary.length >= 5 && binary.length >= 5 + binary.readUInt32BE(1)) {
      const length = binary.readUInt32BE(1);
      frames.push({ kind: binary[0], bytes: binary.subarray(5, 5 + length) });
      binary = binary.subarray(5 + length);
    }
  });
  const send = (kind: number, bytes: Uint8Array) => (child.stdio[3] as Writable).write(frame(kind, bytes));
  const control = (value: object) => send(0, Buffer.from(JSON.stringify(value)));
  const controls = () => frames.filter((f) => f.kind === 0).map((f) => JSON.parse(f.bytes.toString()));
  async function until(check: () => boolean) {
    const deadline = Date.now() + 4000;
    while (!check()) {
      if (child.exitCode !== null) throw new Error("child exited: " + stderr);
      if (Date.now() > deadline)
        throw new Error(
          "timeout: " + JSON.stringify({ events, controls: controls(), frames: frames.map((f) => f.kind), stderr }),
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  async function cleanup() {
    if (child.exitCode !== null) return;
    child.stdin.write("release\nexit\n");
    (child.stdio[3] as Writable).end();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (child.exitCode === null) child.kill();
  }
  return {
    child,
    events,
    frames,
    controls,
    send,
    control,
    until,
    cleanup,
    get stderr() {
      return stderr;
    },
  };
}

for (const provider of ["gemini", "openai"] as const)
  test("spawn FD3/FD4 offline voice " + provider + " frames and delayed stop", async () => {
    const p = pipe();
    try {
      await p.until(() => p.events.some((e) => e.event === "boot") && p.controls().some((e) => e.type === "ready"));
      expect(p.events.find((e) => e.event === "boot")).toEqual({
        event: "boot",
        attached: true,
        markers: [null, null],
        grandchildMarkers: [null, null],
      });
      p.control({ type: "start", provider });
      await p.until(
        () =>
          p.controls().some((e) => e.type === "status" && e.state === "ready") && p.frames.some((f) => f.kind === 2),
      );
      expect(p.events.find((e) => e.event === "key")?.provider).toBe(provider === "gemini" ? "google" : "openai");
      expect(p.frames.find((f) => f.kind === 2)?.bytes).toEqual(Buffer.from([0, 1, 254, 255]));
      p.send(1, Buffer.from([255, 0, 1, 128]));
      await p.until(() => p.events.some((e) => e.event === "audio"));
      expect(p.events.find((e) => e.event === "audio")?.base64).toBe(Buffer.from([255, 0, 1, 128]).toString("base64"));
      p.control({ type: "stop" });
      await p.until(() => p.events.some((e) => e.event === "shutdown_pending"));
      expect(p.controls().some((e) => e.type === "stopped")).toBe(false);
      p.child.stdin.write("work\n");
      await p.until(() => p.events.some((e) => e.event === "work"));
      expect(p.events.find((e) => e.event === "work")?.jobStops).toBe(0);
      p.child.stdin.write("release\n");
      await p.until(() => p.controls().some((e) => e.type === "stopped"));
      expect(p.controls().find((e) => e.type === "stopped")?.stopped).toBe(true);
      expect(p.events.some((e) => e.event === "shutdown_done")).toBe(true);
      const workBefore = p.events.find((e) => e.event === "work")!.work;
      await new Promise((resolve) => setTimeout(resolve, 30));
      p.child.stdin.write("work\n");
      await p.until(() => p.events.filter((e) => e.event === "work").length === 2);
      expect(p.events.filter((e) => e.event === "work")[1].work).toBeGreaterThan(workBefore);
      expect(p.child.exitCode).toBe(null);
    } finally {
      await p.cleanup();
    }
  });

test("oversized inbound frame fails closed on physical FD channel without stopping process work", async () => {
  const p = pipe();
  try {
    await p.until(() => p.controls().some((e) => e.type === "ready"));
    const bad = Buffer.alloc(5);
    bad[0] = 1;
    bad.writeUInt32BE(65537, 1);
    (p.child.stdio[3] as Writable).write(bad);
    await p.until(() => (p.child.stdio[4] as any).readableEnded || (p.child.stdio[4] as any).destroyed);
    p.child.stdin.write("work\n");
    await p.until(() => p.events.some((e) => e.event === "work"));
    expect(p.events.find((e) => e.event === "work")?.jobStops).toBe(0);
    expect(p.events.some((e) => e.event === "connect")).toBe(false);
    expect(p.child.exitCode).toBe(null);
  } finally {
    await p.cleanup();
  }
});
