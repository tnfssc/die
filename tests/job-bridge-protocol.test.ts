import { expect, spyOn, test } from "bun:test";
import { Duplex } from "node:stream";
import { inspectDiagnostics } from "../src/diagnostics";
import { installJobGlobals, MAX_JOB_BRIDGE_FRAME_BYTES, serveJobBridge } from "../src/typescript/job-bridge";

function socket() {
  return new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}
for (const [frame, code] of [
  ["{invalid-secret-frame\n", "protocol_invalid"],
  [JSON.stringify({ id: 1, method: 42, params: "secret" }) + "\n", "protocol_invalid"],
  ["x".repeat(MAX_JOB_BRIDGE_FRAME_BYTES + 1), "frame_oversize"],
] as const) {
  test(
    "server classifies malformed envelope or frame without retaining payload: " + code + ":" + frame.length,
    async () => {
      const stream = socket(),
        owner = {};
      let calls = 0;
      const bridge = serveJobBridge(
        stream,
        async () => {
          calls++;
        },
        new AbortController().signal,
        owner,
      );
      stream.push(Buffer.from(frame));
      await Bun.sleep(1);
      expect(calls).toBe(0);
      const records = inspectDiagnostics(owner).records;
      expect(records.some((record) => record.code === code)).toBe(true);
      expect(JSON.stringify(records)).not.toContain("secret");
      bridge.close();
    },
  );
}

test("invalid ACK and parent cancellation release requests exactly once with distinct causes", async () => {
  for (const cause of ["ack", "shutdown", "timeout", "caller"] as const) {
    const stream = socket(),
      owner = {},
      abort = new AbortController();
    let released = 0;
    const bridge = serveJobBridge(
      stream,
      async (_m, _p, signal) => {
        signal.addEventListener(
          "abort",
          () => {
            released++;
          },
          { once: true },
        );
        return new Promise(() => {});
      },
      abort.signal,
      owner,
    );
    stream.push(Buffer.from(JSON.stringify({ id: 1, method: "shell", params: { command: "secret" } }) + "\n"));
    await Bun.sleep(1);
    if (cause === "ack") stream.push(Buffer.from('{"ack":1}\n'));
    else abort.abort(cause);
    await Bun.sleep(1);
    bridge.close();
    bridge.close();
    expect(released).toBe(1);
    const records = inspectDiagnostics(owner).records;
    const code = cause === "ack" ? "protocol_invalid" : cause === "caller" ? "caller_aborted" : cause;
    expect(records.some((record) => record.code === code)).toBe(true);
    expect(JSON.stringify(records)).not.toContain("secret");
  }
});

test("client EPIPE has a stable symbolic category rather than generic disconnect", async () => {
  const saved = Object.fromEntries(
    ["shell", "subagent", "handoff", "history", "goal", "jobs"].map((key) => [key, (globalThis as any)[key]]),
  );
  const stream = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error("secret"), { code: "EPIPE" }));
    },
  });
  const client = installJobGlobals(stream);
  try {
    const error = await globalThis.shell("secret-command").catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code: string }).code).toBe("bridge_epipe");
    expect((error as Error).message).not.toContain("secret");
    await client.finish();
  } finally {
    stream.destroy();
    for (const [key, value] of Object.entries(saved)) (globalThis as any)[key] = value;
  }
});

function saveJobGlobals() {
  const saved = Object.fromEntries(
    ["shell", "subagent", "handoff", "history", "goal", "jobs"].map((key) => [key, (globalThis as any)[key]]),
  );
  return () => {
    for (const [key, value] of Object.entries(saved)) (globalThis as any)[key] = value;
  };
}

test("client and server reject an accumulated oversized frame before concatenating it", async () => {
  const originalConcat = Buffer.concat;
  const concat = spyOn(Buffer, "concat").mockImplementation(((list: readonly Uint8Array[], totalLength?: number) => {
    const length = totalLength ?? list.reduce((sum, item) => sum + item.length, 0);
    if (length > MAX_JOB_BRIDGE_FRAME_BYTES) throw new Error("oversized concat attempted");
    return originalConcat(list, totalLength);
  }) as typeof Buffer.concat);
  try {
    const serverSocket = socket(),
      owner = {};
    const bridge = serveJobBridge(serverSocket, async () => null, new AbortController().signal, owner);
    serverSocket.push(Buffer.alloc(Math.floor(MAX_JOB_BRIDGE_FRAME_BYTES / 2), 120));
    serverSocket.push(Buffer.alloc(Math.ceil(MAX_JOB_BRIDGE_FRAME_BYTES / 2) + 1, 120));
    await Bun.sleep(1);
    expect(inspectDiagnostics(owner).records.some((record) => record.code === "frame_oversize")).toBe(true);
    bridge.close();

    const restore = saveJobGlobals();
    const clientSocket = socket();
    const client = installJobGlobals(clientSocket);
    try {
      const request = globalThis.shell("echo ok");
      clientSocket.push(Buffer.alloc(Math.floor(MAX_JOB_BRIDGE_FRAME_BYTES / 2), 120));
      clientSocket.push(Buffer.alloc(Math.ceil(MAX_JOB_BRIDGE_FRAME_BYTES / 2) + 1, 120));
      const error = await request.catch((reason) => reason);
      expect((error as Error & { code: string }).code).toBe("frame_oversize");
      await client.finish();
    } finally {
      clientSocket.destroy();
      restore();
    }
  } finally {
    concat.mockRestore();
  }
});

test("client and server accept multi-frame chunks larger than one frame limit", async () => {
  const payload = "x".repeat(Math.floor(MAX_JOB_BRIDGE_FRAME_BYTES * 0.51));
  const requests = [1, 2].map((id) => JSON.stringify({ id, method: "test", params: payload }) + "\n").join("");
  expect(Buffer.byteLength(requests)).toBeGreaterThan(MAX_JOB_BRIDGE_FRAME_BYTES);
  const serverSocket = socket();
  let calls = 0;
  const bridge = serveJobBridge(
    serverSocket,
    async () => {
      calls++;
      return null;
    },
    new AbortController().signal,
  );
  serverSocket.push(Buffer.from(requests));
  await Bun.sleep(1);
  expect(calls).toBe(2);
  bridge.close();

  const restore = saveJobGlobals();
  const clientSocket = socket();
  const client = installJobGlobals(clientSocket);
  try {
    const first = globalThis.shell("one");
    const second = globalThis.shell("two");
    const responses = [1, 2].map((id) => JSON.stringify({ id, result: payload }) + "\n").join("");
    expect(Buffer.byteLength(responses)).toBeGreaterThan(MAX_JOB_BRIDGE_FRAME_BYTES);
    clientSocket.push(Buffer.from(responses));
    expect(await first).toBe(payload);
    expect(await second).toBe(payload);
    await client.finish();
  } finally {
    clientSocket.destroy();
    restore();
  }
});
