/** Offline compiled Die RPC entrypoint + private pipe smoke; no prompt/provider call. */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";
const temp = await mkdtemp(join(tmpdir(), "die-rpc-voice-package-"));
await mkdir(join(temp, "agent"));
const child = spawn(resolve(process.env.DIE_COMPILED_PATH ?? "dist/die"), ["--mode", "rpc", "--no-session"], {
  cwd: temp,
  env: {
    PATH: process.env.PATH,
    HOME: temp,
    TMPDIR: temp,
    TERM: "dumb",
    NO_COLOR: "1",
    DIE_CODING_AGENT_DIR: join(temp, "agent"),
    DIE_WEB_VOICE_FD: "3",
    DIE_WEB_VOICE_OUTPUT_FD: "4",
  },
  stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
});
const controls: any[] = [],
  rpc: any[] = [];
let pending = Buffer.alloc(0),
  text = "",
  errorBytes = 0;
child.stderr!.on("data", (chunk) => {
  errorBytes += chunk.length;
});
child.stdout!.on("data", (chunk) => {
  text += chunk.toString();
  assert(text.length < 1024 * 1024);
  let end: number;
  while ((end = text.indexOf("\n")) >= 0) {
    const line = text.slice(0, end);
    text = text.slice(end + 1);
    try {
      rpc.push(JSON.parse(line));
    } catch {}
  }
});
(child.stdio[4] as any).on("data", (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk]);
  assert(pending.length <= 131072);
  while (pending.length >= 5) {
    const length = pending.readUInt32BE(1);
    assert(length <= 16384);
    if (pending.length < 5 + length) break;
    assert.equal(pending[0], 0);
    controls.push(JSON.parse(pending.subarray(5, 5 + length).toString()));
    pending = pending.subarray(5 + length);
  }
});
const send = (value: object) => {
  const payload = Buffer.from(JSON.stringify(value));
  const head = Buffer.alloc(5);
  head.writeUInt32BE(payload.length, 1);
  (child.stdio[3] as any).write(Buffer.concat([head, payload]));
};
async function wait(test: () => boolean) {
  const until = Date.now() + 20000;
  while (!test()) {
    if (child.exitCode !== null || Date.now() > until)
      throw new Error("Compiled RPC voice smoke failed (exit=" + child.exitCode + ", stderrBytes=" + errorBytes + ")");
    await Bun.sleep(25);
  }
}
try {
  await wait(() => controls.some((value) => value.type === "ready"));
  child.stdin!.write(JSON.stringify({ type: "get_state", id: "voice-smoke-before" }) + "\n");
  await wait(() => rpc.some((value) => value.id === "voice-smoke-before"));
  for (const provider of ["gemini", "openai"]) {
    const before = controls.length;
    send({ type: "start", provider });
    await wait(() =>
      controls.slice(before).some((value) => value.type === "error" && value.code === "credentials_unavailable"),
    );
    send({ type: "stop" });
    await wait(() => controls.slice(before).some((value) => value.type === "stopped" && value.stopped === true));
  }
  child.stdin!.write(JSON.stringify({ type: "get_state", id: "voice-smoke-after" }) + "\n");
  await wait(() => rpc.some((value) => value.id === "voice-smoke-after"));
  assert.equal(rpc.find((value) => value.id === "voice-smoke-before")?.success, true);
  assert.equal(rpc.find((value) => value.id === "voice-smoke-after")?.success, true);
  assert.equal(child.exitCode, null);
  console.log(
    JSON.stringify({
      compiledRpcEntry: true,
      providers: ["gemini", "openai"],
      missingCredentials: true,
      voiceStopped: true,
      codingRpcAlive: true,
      paidCalls: 0,
    }),
  );
} finally {
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    await exited;
    clearTimeout(timer);
  }
  await rm(temp, { recursive: true, force: true });
}
