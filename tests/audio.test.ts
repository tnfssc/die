import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { type AudioProcess, type AudioSpawn, checkAudioCapabilities, SoxAudioAdapter } from "../src/live/audio";

class FakeStream extends EventEmitter {
  writes: Buffer[] = [];
  accept = true;
  destroyed = false;
  write(value: Uint8Array) {
    this.writes.push(Buffer.from(value));
    return this.accept;
  }
  destroy() {
    this.destroyed = true;
  }
}
class FakeProcess extends EventEmitter {
  stdin: FakeStream | null;
  stdout: FakeStream | null;
  killed: NodeJS.Signals[] = [];
  constructor(input: boolean, output: boolean) {
    super();
    this.stdin = input ? new FakeStream() : null;
    this.stdout = output ? new FakeStream() : null;
  }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.killed.push(signal);
    return true;
  }
}
const capability = async () => ({
  supported: true,
  recorderPath: "/tools/rec",
  playerPath: "/tools/play",
  requirements: "test",
});
function rig(options: { limit?: number } = {}) {
  const calls: { command: readonly string[]; process: FakeProcess }[] = [];
  const spawn: AudioSpawn = (command, stdio) => {
    const process = new FakeProcess(stdio[0] === "pipe", stdio[1] === "pipe");
    calls.push({ command, process });
    return process as unknown as AudioProcess;
  };
  const adapter = new SoxAudioAdapter({ checkCapabilities: capability, spawn, maxPlaybackBytes: options.limit });
  return { adapter, calls };
}

describe("audio capability preflight", () => {
  test("rejects non-Linux and SSH without probing commands", async () => {
    let probes = 0;
    const access = async () => {
      probes++;
    };
    expect((await checkAudioCapabilities({ platform: "darwin", env: {}, access })).reason).toContain("only on Linux");
    expect(
      (await checkAudioCapabilities({ platform: "linux", env: { SSH_TTY: "/dev/pts/1" }, access })).reason,
    ).toContain("SSH");
    expect(probes).toBe(0);
  });
  test("finds both executable commands on PATH without spawning", async () => {
    const seen: string[] = [];
    const result = await checkAudioCapabilities({
      platform: "linux",
      env: { PATH: "/one:/two" },
      access: async (path) => {
        seen.push(path);
        if (path !== "/two/rec" && path !== "/two/play") throw new Error("missing");
      },
    });
    expect(result).toMatchObject({ supported: true, recorderPath: "/two/rec", playerPath: "/two/play" });
    expect(seen).toContain("/one/rec");
  });
  test("reports missing tools explicitly", async () => {
    const result = await checkAudioCapabilities({
      platform: "linux",
      env: { PATH: "/bin" },
      access: async () => {
        throw new Error("missing");
      },
    });
    expect(result).toMatchObject({ supported: false });
    expect(result.reason).toContain("rec and play");
  });
});

test("start is explicit, preflights first, and starts one streaming process per direction", async () => {
  const { adapter, calls } = rig();
  expect(calls).toHaveLength(0);
  await adapter.start(
    () => {},
    () => {},
    () => {},
  );
  expect(calls).toHaveLength(2);
  expect(calls[0]!.command[0]).toBe("/tools/play");
  expect(calls[0]!.command).toContain("24000");
  expect(calls[1]!.command[0]).toBe("/tools/rec");
  expect(calls[1]!.command).toContain("16000");
  adapter.play(Buffer.from([1, 0]).toString("base64"));
  adapter.play(Buffer.from([2, 0]).toString("base64"));
  expect(calls).toHaveLength(2);
  expect(calls[0]!.process.stdin!.writes).toEqual([Buffer.from([1, 0]), Buffer.from([2, 0])]);
  adapter.close();
});

test("streams aligned microphone PCM and reactive RMS levels", async () => {
  const { adapter, calls } = rig();
  const audio: string[] = [];
  const levels: number[] = [];
  await adapter.start(
    (value) => audio.push(value),
    (value) => levels.push(value),
    () => {},
  );
  const recorder = calls[1]!.process;
  recorder.stdout!.emit("data", Buffer.from([0x00]));
  recorder.stdout!.emit("data", Buffer.from([0x40, 0x00, 0xc0]));
  expect(Buffer.from(audio[0]!, "base64")).toEqual(Buffer.from([0x00, 0x40, 0x00, 0xc0]));
  expect(levels[0]).toBeCloseTo(0.5);
  adapter.close();
});

test("backpressure queues bounded audio and resumes on drain", async () => {
  const { adapter, calls } = rig({ limit: 4 });
  const errors: Error[] = [];
  await adapter.start(
    () => {},
    () => {},
    (error) => errors.push(error),
  );
  const input = calls[0]!.process.stdin!;
  input.accept = false;
  adapter.play(Buffer.from([1, 0]).toString("base64"));
  adapter.play(Buffer.from([2, 0]).toString("base64"));
  adapter.play(Buffer.from([3, 0]).toString("base64"));
  expect(input.writes).toHaveLength(1);
  expect(errors).toHaveLength(0);
  input.accept = true;
  input.emit("drain");
  expect(input.writes).toHaveLength(3);
  adapter.close();
});

test("queue overflow is explicit and cleans up both children", async () => {
  const { adapter, calls } = rig({ limit: 2 });
  const errors: Error[] = [];
  await adapter.start(
    () => {},
    () => {},
    (error) => errors.push(error),
  );
  calls[0]!.process.stdin!.accept = false;
  adapter.play(Buffer.from([1, 0]).toString("base64"));
  adapter.play(Buffer.from([2, 0]).toString("base64"));
  adapter.play(Buffer.from([3, 0]).toString("base64"));
  expect(errors[0]?.message).toContain("queue exceeded");
  expect(calls[0]!.process.killed).toEqual(["SIGTERM"]);
  expect(calls[1]!.process.killed).toEqual(["SIGTERM"]);
});

test("interrupt immediately replaces only the persistent player and clears queued audio", async () => {
  const { adapter, calls } = rig();
  await adapter.start(
    () => {},
    () => {},
    () => {},
  );
  calls[0]!.process.stdin!.accept = false;
  adapter.play(Buffer.from([1, 0]).toString("base64"));
  adapter.play(Buffer.from([2, 0]).toString("base64"));
  adapter.interrupt();
  expect(calls).toHaveLength(3);
  expect(calls[0]!.process.killed).toEqual(["SIGTERM"]);
  expect(calls[1]!.process.killed).toEqual([]);
  expect(calls[2]!.command[0]).toBe("/tools/play");
  adapter.play(Buffer.from([3, 0]).toString("base64"));
  expect(calls[2]!.process.stdin!.writes).toEqual([Buffer.from([3, 0])]);
  adapter.close();
});

test("an unexpected child exit reports once and cleans up every owned child", async () => {
  const { adapter, calls } = rig();
  const errors: Error[] = [];
  await adapter.start(
    () => {},
    () => {},
    (error) => errors.push(error),
  );
  calls[1]!.process.emit("exit", 7, null);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.message).toContain("recorder exited unexpectedly");
  expect(calls[0]!.process.killed).toEqual(["SIGTERM"]);
  expect(calls[1]!.process.killed).toEqual(["SIGTERM"]);
  calls[0]!.process.emit("exit", 0, null);
  expect(errors).toHaveLength(1);
});

test("failed capability check starts no process", async () => {
  let spawned = false;
  const adapter = new SoxAudioAdapter({
    checkCapabilities: async () => ({ supported: false, reason: "no audio", requirements: "test" }),
    spawn: (() => {
      spawned = true;
      throw new Error("should not spawn");
    }) as AudioSpawn,
  });
  await expect(
    adapter.start(
      () => {},
      () => {},
      () => {},
    ),
  ).rejects.toThrow("no audio");
  expect(spawned).toBe(false);
});
