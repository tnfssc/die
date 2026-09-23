/** Opt-in Linux virtual-Pulse acceptance; never imported by the ordinary test suite. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { LiveLabAudio, audioEnvironment } from "../src/live-lab/audio";
import { VoiceSession } from "../src/live-lab/session";
import { createDefaultLiveCredentialService } from "../src/live/credentials";
import { PlaybackScheduler } from "../src/live-lab/playback";

const paid = process.argv.includes("--provider");
const args = process.argv.slice(2);
if (process.platform !== "linux" || args.some(a => a !== "--provider") ||
    (paid && process.env.DIE_RUN_LIVE_LAB_ACCEPTANCE !== "1")) {
  console.error("Linux required; paid mode requires --provider and DIE_RUN_LIVE_LAB_ACCEPTANCE=1");
  process.exit(2);
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const deadline = Date.now() + 55_000; // reserve up to 5s for teardown
let cleaning = false;
const within = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  const remain = cleaning ? ms : Math.min(ms, deadline - Date.now());
  if (remain <= 0) throw new Error("Acceptance deadline exceeded");
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Acceptance deadline exceeded")), remain);
  })]); } finally { clearTimeout(timer!); }
};
const env = audioEnvironment();
const run = async (cmd: string, argv: string[], ms = 4000): Promise<Buffer> => {
  const p = spawn(cmd, argv, { env, stdio: ["ignore", "pipe", "pipe"] });
  const parts: Buffer[] = []; let size = 0;
  p.stdout.on("data", (b: Buffer) => { size += b.length; if (size > 3_000_000) p.kill(); else parts.push(b); });
  p.stderr.resume();
  const code = await within(new Promise<number>((ok, bad) => {
    p.once("error", () => bad(new Error(cmd + " unavailable")));
    p.once("close", c => ok(c ?? -1));
  }), ms).catch(e => { p.kill("SIGKILL"); throw e; });
  if (code !== 0) throw new Error(cmd + " failed");
  return Buffer.concat(parts);
};
const listen = (cmd: string, argv: string[]): ChildProcessWithoutNullStreams => {
  const p = spawn(cmd, argv, { env, stdio: ["pipe", "pipe", "pipe"] });
  p.stderr.resume();
  p.on("error", () => {});
  return p;
};
const pcmTone = (hz: number, seconds: number): Buffer => {
  const out = Buffer.alloc(Math.round(seconds * 24000) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const fade = Math.min(1, i / 240, (out.length / 2 - i) / 240);
    out.writeInt16LE(Math.round(10000 * fade * Math.sin(2 * Math.PI * hz * i / 24000)), i * 2);
  }
  return out;
};
// A matched-frequency window proves the final marker reached the output monitor; queue=0 alone does not.
const toneScore = (pcm: Buffer, hz: number, start: number): number => {
  const count = 2400; let sine = 0, cosine = 0, energy = 0;
  for (let i = 0; i < count; i++) {
    const x = pcm.readInt16LE((start + i) * 2);
    const phase = 2 * Math.PI * hz * i / 24000;
    sine += x * Math.sin(phase); cosine += x * Math.cos(phase); energy += x * x;
  }
  return energy ? Math.min(1, 2 * (sine * sine + cosine * cosine) / (count * energy)) : 0;
};
const peak = (pcm: Buffer, hz: number, from = 0): { score: number; atMs: number } => {
  let score = 0, atMs = -1;
  for (let i = Math.max(0, from); i + 2400 <= pcm.length / 2; i += 1200) {
    const s = toneScore(pcm, hz, i);
    if (s > score) { score = s; atMs = Math.round(i / 24); }
  }
  return { score: Number(score.toFixed(3)), atMs };
};

// Correlate a high-energy 80ms window near the provider's final samples to the virtual monitor.
// Native timing may shift; match polarity and offset, not transcript or audio content in logs.
function tailCorrelation(sent: Buffer, heard: Buffer): { score: number; atMs: number } {
  const length = 1920, samples = sent.length / 2;
  let bestEnergy = 0, chosen = -1;
  for (let start = Math.max(0, samples - 12000); start + length <= samples; start += 480) {
    let energy = 0;
    for (let j = 0; j < length; j += 8) energy += sent.readInt16LE((start + j) * 2) ** 2;
    if (energy > bestEnergy) { bestEnergy = energy; chosen = start; }
  }
  if (chosen < 0 || bestEnergy < 1e6) return { score: 0, atMs: -1 };
  let score = 0, atMs = -1;
  for (let start = 0; start + length <= heard.length / 2; start += 24) {
    let dot = 0, energy = 0;
    for (let j = 0; j < length; j += 8) {
      const x = sent.readInt16LE((chosen + j) * 2), y = heard.readInt16LE((start + j) * 2);
      dot += x * y; energy += y * y;
    }
    const match = energy ? Math.abs(dot) / Math.sqrt(bestEnergy * energy) : 0;
    if (match > score) { score = match; atMs = Math.round(start / 24); }
  }
  return { score: Number(score.toFixed(3)), atMs };
}

// PipeWire stream-restore can silently override an explicit device. Check both actual
// links BEFORE enqueueing any audio; fail closed instead of risking physical output.
async function checkRoutes(pid: number, mic: string, output: string) {
  const sinks = (await run("pactl", ["list", "short", "sinks"])).toString();
  const sources = (await run("pactl", ["list", "short", "sources"])).toString();
  const sinkIndex = sinks.split("\n").find(l => l.split("\t")[1] === output)?.split("\t")[0];
  const sourceIndex = sources.split("\n").find(l => l.split("\t")[1] === mic + ".monitor")?.split("\t")[0];
  if (!sinkIndex || !sourceIndex) throw new Error("Virtual endpoints unavailable");
  const target = async (kind: "sink-inputs" | "source-outputs", line: "Sink" | "Source") => {
    const blocks = (await run("pactl", ["list", kind])).toString().split(/(?=^(?:Sink Input|Source Output) #)/m);
    const owned = blocks.filter(block => block.includes('application.process.id = "' + pid + '"'));
    if (owned.length !== 1) throw new Error("Helper route unavailable");
    const id = owned[0].match(/^(?:Sink Input|Source Output) #(\d+)/m)?.[1];
    const route = owned[0].match(new RegExp("^\\s*" + line + ": (\\d+)$", "m"))?.[1];
    if (!id || !route) throw new Error("Helper route unavailable");
    return { id, route };
  };
  const sink = await target("sink-inputs", "Sink"), source = await target("source-outputs", "Source");
  if (sink.route !== sinkIndex) throw new Error("Helper output was routed away from virtual sink; refusing playback");
  if (source.route !== sourceIndex) throw new Error("Helper input was routed away from virtual monitor; refusing capture");
}

async function main() {
  // No default route changes and no daemon auto-start: fail if daemon/tools are absent.
  await run("pactl", ["info"]);
  const helper = resolve(process.env.DIE_LIVE_LAB_HELPER ?? "dist/live-lab-audio-linux");
  await access(helper);
  const tag = "die_accept_" + process.pid + "_" + randomBytes(5).toString("hex");
  const mic = tag + "_input", output = tag + "_output";
  const modules: string[] = [];
  const children: ChildProcessWithoutNullStreams[] = [];
  let audio: LiveLabAudio | undefined;
  let voice: VoiceSession | undefined;
  let playback: PlaybackScheduler | undefined;
  try {
    for (const sink of [mic, output]) {
      const id = (await run("pactl", ["load-module", "module-null-sink", "sink_name=" + sink])).toString().trim();
      if (!/^\d+$/.test(id)) throw new Error("Cannot load virtual sink");
      modules.push(id);
    }
    const monitor = listen("parec", ["--device=" + output + ".monitor", "--format=s16le", "--rate=24000", "--channels=1", "--raw"]);
    children.push(monitor);
    const monitorSourceIndex = (await run("pactl", ["list", "short", "sources"])).toString().split("\n")
      .find(line => line.split("\t")[1] === output + ".monitor")?.split("\t")[0];
    const monitorRoute = (await run("pactl", ["list", "source-outputs"])).toString().split(/(?=^Source Output #)/m)
      .find(block => block.includes('application.process.id = "' + monitor.pid + '"'));
    if (!monitorSourceIndex || !monitorRoute || !monitorRoute.includes("Source: " + monitorSourceIndex + "\n"))
      throw new Error("Monitor was routed away from virtual source");
    const outputParts: Buffer[] = []; let outputBytes = 0;
    monitor.stdout.on("data", (b: Buffer) => {
      outputBytes += b.length;
      if (outputBytes > 4_000_000) monitor.kill(); else outputParts.push(b);
    });
    // Always inject the REAL helper process; only this harness bypasses the controller's TTY guard.
    env.LIVE_LAB_SOURCE = mic + ".monitor";
    env.LIVE_LAB_SINK = output;
    env.PULSE_SOURCE = mic + ".monitor"; env.PULSE_SINK = output;
    const worker = listen(helper, ["--source", mic + ".monitor", "--sink", output]); children.push(worker);
    const failures: string[] = []; let sentFrames = 0, nonzeroQueue = 0;
    let captured = 0, turns = 0, inputTranscript = false, outputTranscript = false, outputAudio = false;
    let queueDrainedAt = -1, completeAt = -1;
    const providerParts: Buffer[] = [];
    audio = await within(LiveLabAudio.launch({ worker, callbacks: {
      capture: b => { captured++; if (paid && voice?.state === "ready") voice.sendAudio(b.toString("base64")); },
      played: ms => { if (ms > 0) nonzeroQueue++; playback?.nativeQueued(ms); if (ms === 0 && completeAt > 0 && queueDrainedAt < 0) queueDrainedAt = Date.now(); },
      error: () => failures.push("helper"),
    } }), 4000);
    playback = new PlaybackScheduler({ send: (b, gen) => { sentFrames++; return audio!.play(b, gen); }, flush: gen => audio!.flush(gen),
      onError: () => failures.push("playback") });
    await within(audio.start(), 8000);
    await checkRoutes(worker.pid!, mic, output);
    playback.start();
    // Fixture injects ONLY provider messages; it does not replace the native helper or scheduler.
    if (!paid) {
      const lead = pcmTone(430, 2.4), tail = pcmTone(830, 0.45);
      const result = Buffer.concat([lead, tail]);
      const adapter = (() => ({ live: { connect: async ({ callbacks }: any) => {
        setTimeout(() => {
          for (let offset = 0; offset < result.length; offset += 9600) {
            callbacks.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: {
              mimeType: "audio/pcm;rate=24000", data: result.subarray(offset, offset + 9600).toString("base64"),
            } }] } } });
          }
          callbacks.onmessage({ serverContent: { turnComplete: true } });
          completeAt = Date.now();
        }, 5);
        return { close() {}, sendRealtimeInput() {} };
      } } })) as any;
      voice = new VoiceSession({
        onAudio: (data, gen) => { outputAudio = true; if (!playback!.enqueue(Buffer.from(data, "base64"), gen)) failures.push("enqueue"); },
        onTurnComplete: () => { turns++; playback!.turnComplete(voice!.generation); },
        onError: () => failures.push("voice"),
      }, adapter);
      await within(voice.connect("fixture-not-a-key"), 5000);
      await within((async () => { while (!peak(Buffer.concat(outputParts), 830).score || peak(Buffer.concat(outputParts), 830).score < .65) {
        if (failures.length) throw new Error("Audio pipeline failed");
        await sleep(80);
      } })(), 8500).catch(() => { const monitorPcm = Buffer.concat(outputParts); let maxSample = 0; for (let i=0;i+1<monitorPcm.length;i+=2) maxSample=Math.max(maxSample,Math.abs(monitorPcm.readInt16LE(i))); throw new Error("Tail not observed: " + JSON.stringify({ maxSample, sentFrames, nonzeroQueue, monitorBytes: outputBytes, tail: peak(Buffer.concat(outputParts), 830), captured, turns, outputAudio, failures, pending: playback!.state.pendingBytes, queuedMs: audio!.diagnostics.queuedMs })); });
      await within((async () => { while (audio!.diagnostics.queuedMs !== 0 || playback!.state.pendingBytes !== 0 || playback!.state.inFlight) await sleep(50); })(), 3500);
      await checkRoutes(worker.pid!, mic, output);
      const rendered = Buffer.concat(outputParts);
      const tailProof = peak(rendered, 830);
      if (tailProof.score < .65 || !turns || !outputAudio || !captured) throw new Error("Fixture tail/capture proof failed");
      // Separate interruption: long old signal is queued, then deliberately flushed; capture stays open.
      const old = pcmTone(1130, 2.5), before = captured;
      if (!playback.enqueue(old, 0)) throw new Error("Cannot queue stale playback");
      await sleep(180);
      const flushAt = outputBytes / 2;
      playback.interrupt(1);
      await sleep(750);
      const after = Buffer.concat(outputParts);
      const postFlush = peak(after, 1130, flushAt + 4800); // allow 200ms Pulse latency
      if (postFlush.score > .4 || captured <= before || failures.length) throw new Error("Flush/capture proof failed");
      console.log(JSON.stringify({ mode: "fixture", ok: true, outputTail: tailProof,
        turnCompleteBeforeTail: completeAt > 0 && completeAt < Date.now(),
        queueDrained: queueDrainedAt > 0, postFlushOldTone: postFlush, captureContinued: captured > before }));
    } else {
      const key = await (await createDefaultLiveCredentialService()).loadKey();
      voice = new VoiceSession({
        onAudio: (data, gen) => { outputAudio = true; const pcm = Buffer.from(data, "base64"); providerParts.push(pcm); if (!playback!.enqueue(pcm, gen)) failures.push("enqueue"); },
        onInputTranscript: t => { if (t.text) inputTranscript = true; },
        onOutputTranscript: t => { if (t.text) outputTranscript = true; },
        onInterrupted: gen => playback!.interrupt(gen),
        onTurnComplete: () => { turns++; playback!.turnComplete(voice!.generation); completeAt = Date.now(); },
        onError: () => failures.push("voice"),
      });
      await within(voice.connect(key), 16000);
      // Speech is generated and converted locally; nothing is recorded on disk.
      const wav = await run("espeak-ng", ["--stdout", "Please say a short reply ending with the word lighthouse."], 4000);
      const ff = listen("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"]);
      children.push(ff); ff.stdin.end(wav);
      const speechParts: Buffer[] = []; ff.stdout.on("data", (b: Buffer) => speechParts.push(b));
      await within(new Promise<void>((yes, no) => ff.once("close", c => c === 0 ? yes() : no(new Error("Conversion failed")))), 4000);
      env.PULSE_SINK = mic;
      const speaker = listen("pacat", ["--playback", "--device=" + mic, "--format=s16le", "--rate=16000", "--channels=1", "--raw"]);
      children.push(speaker);
      const sinkIndex = (await run("pactl", ["list", "short", "sinks"])).toString().split("\n")
        .find(line => line.split("\t")[1] === mic)?.split("\t")[0];
      const ownInput = (await run("pactl", ["list", "sink-inputs"])).toString().split(/(?=^Sink Input #)/m)
        .find(block => block.includes('application.process.id = "' + speaker.pid + '"'));
      if (!sinkIndex || !ownInput || !ownInput.includes("Sink: " + sinkIndex + "\n"))
        throw new Error("Synthetic input was routed away from virtual sink");
      speaker.stdin.end(Buffer.concat(speechParts));
      await within(new Promise<void>((yes, no) => speaker.once("close", c => c === 0 ? yes() : no(new Error("Input injection failed")))), 8000);
      await sleep(500); voice.endAudio();
      await within((async () => { while (!(turns && playback!.state.pendingBytes === 0 && !playback!.state.inFlight && audio!.diagnostics.queuedMs === 0)) {
        if (failures.length) throw new Error("Pipeline failed"); await sleep(100);
      } })(), 25_000);
      await sleep(350);
      await checkRoutes(worker.pid!, mic, output);
      const correlation = tailCorrelation(Buffer.concat(providerParts), Buffer.concat(outputParts));
      const ok = inputTranscript && outputTranscript && outputAudio && turns > 0 && captured > 0 && correlation.score > .45 && !failures.length;
      console.log(JSON.stringify({ mode: "provider", ok, inputTranscript, outputTranscript, outputAudio,
        turnComplete: turns > 0, captureFrames: captured, outputMonitorBytes: outputBytes,
        queueDrained: queueDrainedAt > 0, tailCorrelation: correlation, elapsedMs: Date.now() - (deadline - 55_000) }));
      if (!ok) throw new Error("Provider acceptance incomplete");
    }
  } finally {
    cleaning = true;
    voice?.close(); playback?.close();
    if (audio) await within(audio.stop(), 2500).catch(() => audio!.close());
    for (const p of children) { p.kill("SIGTERM"); setTimeout(() => p.kill("SIGKILL"), 400).unref(); }
    let cleanupFailed = false;
    for (const id of modules.reverse()) await run("pactl", ["unload-module", id], 1000).catch(() => { cleanupFailed = true; });
    if (cleanupFailed) throw new Error("Virtual sink cleanup failed");
  }
}
main().catch(error => { console.error(paid ? "Provider acceptance failed (details suppressed)" : "Fixture acceptance failed: " + (error instanceof Error ? error.message : "unknown")); process.exitCode = 1; });
