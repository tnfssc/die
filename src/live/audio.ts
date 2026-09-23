import { Buffer } from "node:buffer";
import { spawn as nodeSpawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

export const LOCAL_AUDIO_REQUIREMENTS =
  "Linux local session with SoX 'rec' and 'play' on PATH and a working default ALSA/PulseAudio input and output device";
export interface AudioCapabilities {
  supported: boolean;
  reason?: string;
  recorderPath?: string;
  playerPath?: string;
  requirements: string;
}
export interface LiveAudioAdapter {
  start(
    onAudio: (pcm: string) => void,
    onLevel: (level: number) => void,
    onError: (error: Error) => void,
  ): Promise<void>;
  play(base64Pcm16: string): void;
  interrupt(): void;
  close(): void;
}
type Listener = (...args: unknown[]) => void;
interface Emitter {
  on(event: string, listener: Listener): unknown;
  removeListener(event: string, listener: Listener): unknown;
}
export interface AudioWritable extends Emitter {
  write(chunk: Uint8Array): boolean;
  destroy?(): void;
}
export interface AudioProcess extends Emitter {
  stdin: AudioWritable | null;
  stdout: Emitter | null;
  kill(signal?: NodeJS.Signals): boolean;
}
export type AudioSpawn = (
  command: readonly string[],
  stdio: readonly ["ignore" | "pipe", "ignore" | "pipe", "ignore"],
) => AudioProcess;
export interface CapabilityCheckOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  access?: (path: string, mode: number) => Promise<void>;
  commands?: { recorder: string; player: string };
}
async function findExecutable(
  command: string,
  path: string | undefined,
  check: (path: string, mode: number) => Promise<void>,
) {
  const choices =
    isAbsolute(command) || command.includes("/")
      ? [command]
      : (path ?? "")
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir, command));
  for (const choice of choices) {
    try {
      await check(choice, constants.X_OK);
      return choice;
    } catch {}
  }
}
/** Side-effect-free preflight intended to run before opening a Live network session. */
export async function checkAudioCapabilities(options: CapabilityCheckOptions = {}): Promise<AudioCapabilities> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== "linux")
    return {
      supported: false,
      reason: "Local audio is currently supported only on Linux",
      requirements: LOCAL_AUDIO_REQUIREMENTS,
    };
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY)
    return {
      supported: false,
      reason: "Local audio is unavailable in SSH sessions",
      requirements: LOCAL_AUDIO_REQUIREMENTS,
    };
  const commands = options.commands ?? { recorder: "rec", player: "play" };
  const [recorderPath, playerPath] = await Promise.all([
    findExecutable(commands.recorder, env.PATH, options.access ?? access),
    findExecutable(commands.player, env.PATH, options.access ?? access),
  ]);
  if (!recorderPath || !playerPath) {
    const missing = [!recorderPath && commands.recorder, !playerPath && commands.player].filter(Boolean).join(" and ");
    return {
      supported: false,
      reason: "Missing executable on PATH: " + missing,
      recorderPath,
      playerPath,
      requirements: LOCAL_AUDIO_REQUIREMENTS,
    };
  }
  return { supported: true, recorderPath, playerPath, requirements: LOCAL_AUDIO_REQUIREMENTS };
}
export interface SoxAudioAdapterOptions {
  maxPlaybackBytes?: number;
  checkCapabilities?: () => Promise<AudioCapabilities>;
  spawn?: AudioSpawn;
}
const recArgs = [
  "--no-show-progress",
  "--buffer",
  "256",
  "-q",
  "-c",
  "1",
  "-r",
  "16000",
  "-b",
  "16",
  "-e",
  "signed-integer",
  "-L",
  "-t",
  "raw",
  "-",
];
const playArgs = [
  "--no-show-progress",
  "--buffer",
  "256",
  "-q",
  "-c",
  "1",
  "-r",
  "24000",
  "-b",
  "16",
  "-e",
  "signed-integer",
  "-L",
  "-t",
  "raw",
  "-",
];
const realSpawn: AudioSpawn = (command, stdio) => {
  const executable = command[0];
  if (!executable) throw new Error("Audio process command is empty");
  return nodeSpawn(executable, command.slice(1), { shell: false, stdio: [...stdio] }) as unknown as AudioProcess;
};
type Watched = AudioProcess & { __audio?: { error: Listener; exit: Listener; data?: Listener } };

export class SoxAudioAdapter implements LiveAudioAdapter {
  private readonly limit: number;
  private readonly check: () => Promise<AudioCapabilities>;
  private readonly spawn: AudioSpawn;
  private recorder?: AudioProcess;
  private player?: AudioProcess;
  private active = false;
  private starting = false;
  private generation = 0;
  private pendingDrain?: { input: AudioWritable; listener: Listener };
  private waiting = false;
  private queue: Uint8Array[] = [];
  private queueBytes = 0;
  private remainder?: number;
  private callbacks?: { audio: (pcm: string) => void; level: (level: number) => void; error: (error: Error) => void };
  private recCommand?: string;
  private playCommand?: string;
  constructor(options: SoxAudioAdapterOptions = {}) {
    this.limit = options.maxPlaybackBytes ?? 96_000;
    if (!Number.isSafeInteger(this.limit) || this.limit <= 0)
      throw new RangeError("maxPlaybackBytes must be a positive integer");
    this.check = options.checkCapabilities ?? (() => checkAudioCapabilities());
    this.spawn = options.spawn ?? realSpawn;
  }
  async start(audio: (pcm: string) => void, level: (level: number) => void, error: (error: Error) => void) {
    if (this.active || this.starting) throw new Error("Audio adapter is already started");
    this.starting = true;
    const generation = ++this.generation;
    this.callbacks = { audio, level, error };
    try {
      const capability = await this.check();
      if (generation !== this.generation) throw new Error("Audio start cancelled");
      if (!capability.supported || !capability.recorderPath || !capability.playerPath)
        throw new Error(capability.reason ?? LOCAL_AUDIO_REQUIREMENTS);
      this.recCommand = capability.recorderPath;
      this.playCommand = capability.playerPath;
      this.active = true;
      this.player = this.spawnPlayer();
      this.recorder = this.spawnRecorder();
    } catch (cause) {
      this.stop();
      this.callbacks = undefined;
      throw cause instanceof Error ? cause : new Error(String(cause));
    } finally {
      this.starting = false;
    }
  }
  play(base64: string) {
    if (!this.active) throw new Error("Audio adapter is not started");
    const pcm = Buffer.from(base64, "base64");
    if (!pcm.length) return;
    if (pcm.length % 2) return this.fail(new Error("Playback PCM16 payload has an odd byte length"));
    if (this.queueBytes + pcm.length > this.limit)
      return this.fail(new Error("Playback queue exceeded " + this.limit + " bytes"));
    this.queue.push(pcm);
    this.queueBytes += pcm.length;
    this.flush();
  }
  interrupt() {
    if (!this.active) return;
    this.clearQueue();
    const old = this.player;
    this.player = undefined;
    if (old) this.kill(old);
    try {
      this.player = this.spawnPlayer();
    } catch (cause) {
      this.fail(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
  close() {
    this.stop();
    this.callbacks = undefined;
  }
  private spawnPlayer() {
    if (!this.playCommand) throw new Error("SoX player command is unavailable");
    const child = this.spawn([this.playCommand, ...playArgs], ["pipe", "ignore", "ignore"]);
    if (!child.stdin) {
      child.kill("SIGKILL");
      throw new Error("SoX player did not provide stdin");
    }
    this.watch(child, "player");
    return child;
  }
  private spawnRecorder() {
    if (!this.recCommand) throw new Error("SoX recorder command is unavailable");
    const child = this.spawn([this.recCommand, ...recArgs], ["ignore", "pipe", "ignore"]);
    if (!child.stdout) {
      child.kill("SIGKILL");
      throw new Error("SoX recorder did not provide stdout");
    }
    const data: Listener = (value) => this.receive(value);
    child.stdout.on("data", data);
    this.watch(child, "recorder", data);
    return child;
  }
  private watch(child: AudioProcess, role: string, data?: Listener) {
    const error: Listener = (value) => {
      if (this.owns(child)) this.fail(value instanceof Error ? value : new Error("SoX " + role + " failed"));
    };
    const exit: Listener = (code, signal) => {
      if (this.owns(child))
        this.fail(
          new Error("SoX " + role + " exited unexpectedly (code " + String(code) + ", signal " + String(signal) + ")"),
        );
    };
    child.on("error", error);
    child.stdin?.on("error", error);
    child.on("exit", exit);
    (child as Watched).__audio = { error, exit, data };
  }
  private owns(child: AudioProcess) {
    return this.active && (child === this.player || child === this.recorder);
  }
  private receive(value: unknown) {
    if (!this.active) return;
    const input = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    let pcm = this.remainder === undefined ? input : Buffer.concat([Buffer.from([this.remainder]), input]);
    this.remainder = undefined;
    if (pcm.length % 2) {
      this.remainder = pcm.at(-1);
      pcm = pcm.subarray(0, -1);
    }
    if (!pcm.length) return;
    let squares = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      const sample = pcm.readInt16LE(i) / 32768;
      squares += sample * sample;
    }
    try {
      this.callbacks?.audio(pcm.toString("base64"));
      this.callbacks?.level(Math.sqrt(squares / (pcm.length / 2)));
    } catch (cause) {
      this.fail(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
  private flush() {
    const input = this.player?.stdin;
    if (!this.active || !input || this.waiting) return;
    while (this.queue.length) {
      const chunk = this.queue.shift();
      if (!chunk) break;
      this.queueBytes -= chunk.byteLength;
      if (!input.write(chunk)) {
        this.waiting = true;
        const drain: Listener = () => {
          input.removeListener("drain", drain);
          this.pendingDrain = undefined;
          this.waiting = false;
          this.flush();
        };
        this.pendingDrain = { input, listener: drain };
        input.on("drain", drain);
        break;
      }
    }
  }
  private fail(error: Error) {
    if (!this.active) return;
    const report = this.callbacks?.error;
    this.stop();
    try {
      report?.(error);
    } catch {}
  }
  private clearQueue() {
    if (this.pendingDrain) this.pendingDrain.input.removeListener("drain", this.pendingDrain.listener);
    this.pendingDrain = undefined;
    this.queue = [];
    this.queueBytes = 0;
    this.waiting = false;
  }
  private stop() {
    this.generation++;
    this.active = false;
    this.clearQueue();
    this.remainder = undefined;
    const children = [this.recorder, this.player];
    this.recorder = undefined;
    this.player = undefined;
    for (const child of children) if (child) this.kill(child);
  }
  private kill(child: AudioProcess) {
    const watched = (child as Watched).__audio;
    if (watched) {
      // Keep the inert error handlers through process exit: spawn/EPIPE errors
      // may arrive after close, and EventEmitter errors must remain handled.
      child.removeListener("exit", watched.exit);
      if (watched.data && child.stdout) child.stdout.removeListener("data", watched.data);
    }
    try {
      child.stdin?.destroy?.();
    } catch {}
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}
export function createLocalAudioAdapter(options: SoxAudioAdapterOptions = {}): LiveAudioAdapter {
  return new SoxAudioAdapter(options);
}
