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
  test("rejects unsupported platforms and Linux/macOS SSH sessions without probing commands", async () => {
    let probes = 0;
    const access = async () => {
      probes++;
    };
    expect((await checkAudioCapabilities({ platform: "win32", env: {}, access })).reason).toContain(
      "only on Linux and macOS",
    );
    for (const platform of ["linux", "darwin"] as const) {
      expect((await checkAudioCapabilities({ platform, env: { SSH_TTY: "/dev/pts/1" }, access })).reason).toContain(
        "SSH",
      );
    }
    expect(probes).toBe(0);
  });
  test("finds Homebrew rec/play on macOS without opening CoreAudio", async () => {
    const seen: string[] = [];
    const result = await checkAudioCapabilities({
      platform: "darwin",
      env: { PATH: "/usr/bin:/opt/homebrew/bin" },
      access: async (path) => {
        seen.push(path);
        if (!path.startsWith("/opt/homebrew/bin/")) throw new Error("missing");
      },
    });
    expect(result).toMatchObject({
      supported: true,
      recorderPath: "/opt/homebrew/bin/rec",
      playerPath: "/opt/homebrew/bin/play",
    });
    expect(result.requirements).toContain("CoreAudio");
    expect(seen).toContain("/usr/bin/rec");
  });
  test("reports a missing macOS recorder while preserving the executable that exists", async () => {
    const result = await checkAudioCapabilities({
      platform: "darwin",
      env: { PATH: "/opt/homebrew/bin" },
      access: async (path) => {
        if (path !== "/opt/homebrew/bin/play") throw new Error("missing");
      },
    });
    expect(result).toMatchObject({
      supported: false,
      playerPath: "/opt/homebrew/bin/play",
    });
    expect(result.reason).toContain("rec");
    expect(result.reason).not.toContain("rec and play");
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
  expect(calls[0]!.command).not.toContain("coreaudio");
  expect(calls[0]!.command.slice(-3)).toEqual(["-t", "raw", "-"]);
  expect(calls[1]!.command[0]).toBe("/tools/rec");
  expect(calls[1]!.command).toContain("16000");
  expect(calls[1]!.command).not.toContain("coreaudio");
  expect(calls[1]!.command.slice(-3)).toEqual(["-t", "raw", "-"]);
  adapter.play(Buffer.from([1, 0]).toString("base64"));
  adapter.play(Buffer.from([2, 0]).toString("base64"));
  expect(calls).toHaveLength(2);
  expect(calls[0]!.process.stdin!.writes).toEqual([Buffer.from([1, 0]), Buffer.from([2, 0])]);
  adapter.close();
});

test("Linux and Darwin discovery use the same exact PCM pipe arguments and default devices", async () => {
  for (const platform of ["linux", "darwin"] as const) {
    const commands: (readonly string[])[] = [];
    const adapter = new SoxAudioAdapter({
      checkCapabilities: () => checkAudioCapabilities({ platform, env: { PATH: "/tools" }, access: async () => {} }),
      spawn: (command, stdio) => {
        commands.push(command);
        return new FakeProcess(stdio[0] === "pipe", stdio[1] === "pipe") as unknown as AudioProcess;
      },
    });
    await adapter.start(
      () => {},
      () => {},
      () => {},
    );
    for (const [index, tool, rate] of [
      [0, "play", "24000"],
      [1, "rec", "16000"],
    ] as const) {
      expect(commands[index]).toEqual([
        "/tools/" + tool,
        "--no-show-progress",
        "--buffer",
        "256",
        "-q",
        "-c",
        "1",
        "-r",
        rate,
        "-b",
        "16",
        "-e",
        "signed-integer",
        "-L",
        "-t",
        "raw",
        "-",
      ]);
    }
    adapter.close();
  }
});

test("a recorder startup error rejects start and cleans up the macOS player", async () => {
  const player = new FakeProcess(true, false);
  let calls = 0;
  const adapter = new SoxAudioAdapter({
    checkCapabilities: capability,
    spawn: ((command) => {
      calls++;
      if (command[0] === "/tools/rec") throw new Error("CoreAudio input unavailable");
      return player as unknown as AudioProcess;
    }) as AudioSpawn,
  });
  await expect(
    adapter.start(
      () => {},
      () => {},
      () => {},
    ),
  ).rejects.toThrow("CoreAudio input unavailable");
  expect(calls).toBe(2);
  expect(player.killed).toEqual(["SIGKILL"]);
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
  expect(calls[0]!.process.killed).toEqual(["SIGKILL"]);
  expect(calls[1]!.process.killed).toEqual(["SIGKILL"]);
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
  expect(calls[0]!.process.killed).toEqual(["SIGKILL"]);
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
  expect(calls[0]!.process.killed).toEqual(["SIGKILL"]);
  expect(calls[1]!.process.killed).toEqual(["SIGKILL"]);
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

test("close during preflight cannot subsequently open microphone", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof capability>>) => void;
  let spawned = 0;
  const adapter = new SoxAudioAdapter({
    checkCapabilities: () =>
      new Promise((done) => {
        resolve = done;
      }),
    spawn: () => {
      spawned++;
      throw new Error("must not spawn");
    },
  });
  const starting = adapter.start(
    () => {},
    () => {},
    () => {},
  );
  adapter.close();
  resolve(await capability());
  await expect(starting).rejects.toThrow("cancelled");
  expect(spawned).toBe(0);
});

test("EPIPE stops audio and late process errors after close are harmless", async () => {
  const { adapter, calls } = rig();
  const errors: Error[] = [];
  await adapter.start(
    () => {},
    () => {},
    (error) => errors.push(error),
  );
  calls[0]!.process.stdin!.emit("error", new Error("EPIPE"));
  expect(errors).toHaveLength(1);
  expect(calls.every(({ process }) => process.killed.length === 1)).toBe(true);
  expect(() => calls[1]!.process.emit("error", new Error("late spawn error"))).not.toThrow();
  adapter.close();
});

test("interrupt detaches old playback drain listener", async () => {
  const { adapter, calls } = rig();
  await adapter.start(
    () => {},
    () => {},
    () => {},
  );
  const old = calls[0]!.process.stdin!;
  old.accept = false;
  adapter.play(Buffer.alloc(8).toString("base64"));
  expect(old.listenerCount("drain")).toBe(1);
  adapter.interrupt();
  expect(old.listenerCount("drain")).toBe(0);
  adapter.close();
});
