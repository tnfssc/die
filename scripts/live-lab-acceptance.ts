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
if (process.platform !== "linux" || process.env.DIE_LIVE_LAB_ISOLATED !== "1" || args.some(a => a !== "--provider") ||
    (paid && process.env.DIE_RUN_LIVE_LAB_ACCEPTANCE !== "1")) {
  console.error("Linux isolated wrapper required; paid mode additionally requires --provider and DIE_RUN_LIVE_LAB_ACCEPTANCE=1");
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
  const count = 480; let sine = 0, cosine = 0, energy = 0;
  for (let i = 0; i < count; i++) {
    const x = pcm.readInt16LE((start + i) * 2);
    const phase = 2 * Math.PI * hz * i / 24000;
    sine += x * Math.sin(phase); cosine += x * Math.cos(phase); energy += x * x;
  }
  return energy >= count * 1000 * 1000 ? Math.min(1, 2 * (sine * sine + cosine * cosine) / (count * energy)) : 0;
};
const peak = (pcm: Buffer, hz: number, from = 0): { score: number; atMs: number } => {
  let score = 0, atMs = -1;
  for (let i = Math.max(0, from); i + 480 <= pcm.length / 2; i += 240) {
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

// Pulse JSON's numeric sink/source fields are authoritative; the text output's
// indented labels also occur inside properties and are not safe to parse as routes.
type Endpoint = { index: number; name: string };
const listing = async (kind: string): Promise<any[]> => {
  const value = JSON.parse((await run("pactl", ["-f", "json", "list", kind])).toString());
  if (!Array.isArray(value)) throw new Error("Invalid Pulse endpoint listing");
  return value;
};
const endpoint = (items: Endpoint[], name: string): number => {
  const hits = items.filter(x => x.name === name && Number.isInteger(x.index));
  if (hits.length !== 1) throw new Error("Virtual endpoint unavailable: " + name);
  return hits[0].index;
};
async function assertRoute(kind: "sink-inputs" | "source-outputs", pid: number, expected: number) {
  let matches: any[] = [];
  for (let i = 0; i < 20; i++) {
    matches = (await listing(kind)).filter(x => x.properties?.["application.process.id"] === String(pid));
    if (matches.length) break;
    await sleep(50);
  }
  const field = kind === "sink-inputs" ? "sink" : "source";
  if (matches.length !== 1 || !Number.isInteger(matches[0][field]) || matches[0][field] !== expected)
    throw new Error(kind + " was not routed to its virtual endpoint");
}
async function checkRoutes(pid: number, mic: string, output: string) {
  await assertRoute("sink-inputs", pid, endpoint(await listing("sinks"), output));
  await assertRoute("source-outputs", pid, endpoint(await listing("sources"), mic + ".monitor"));
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
    await assertRoute("source-outputs", monitor.pid!, endpoint(await listing("sources"), output + ".monitor"));
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
      const lead = pcmTone(430, 1.6), tail = pcmTone(830, 0.8);
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
      } })(), 8500).catch(() => { const monitorPcm = Buffer.concat(outputParts); let maxSample = 0; for (let i=0;i+1<monitorPcm.length;i+=2) maxSample=Math.max(maxSample,Math.abs(monitorPcm.readInt16LE(i))); throw new Error("Tail not observed: " + JSON.stringify({ maxSample, sentFrames, nonzeroQueue, monitorBytes: outputBytes, tail: peak(Buffer.concat(outputParts), 830), lead: peak(Buffer.concat(outputParts), 430), nearby: [800,810,820,840,850,860].map(hz => [hz, peak(Buffer.concat(outputParts), hz)]), captured, turns, outputAudio, failures, pending: playback!.state.pendingBytes, queuedMs: audio!.diagnostics.queuedMs })); });
      await within((async () => { while (audio!.diagnostics.queuedMs !== 0 || playback!.state.pendingBytes !== 0 || playback!.state.inFlight) await sleep(50); })(), 3500);
      await checkRoutes(worker.pid!, mic, output);
      const rendered = Buffer.concat(outputParts);
      const tailProof = peak(rendered, 830);
      if (tailProof.score < .65 || !turns || !outputAudio || !captured || completeAt <= 0 || completeAt >= Date.now()) throw new Error("Fixture tail/capture proof failed");
      // Separate interruption: long old signal is queued, then deliberately flushed; capture stays open.
      const old = pcmTone(1130, 2.5), before = captured;
      if (!playback.enqueue(old, 0)) throw new Error("Cannot queue stale playback");
      await within((async () => { while (peak(Buffer.concat(outputParts), 1130).score < .7) {
        if (failures.length) throw new Error("Audio pipeline failed");
        await sleep(60);
      } })(), 3000);
      const oldBefore = peak(Buffer.concat(outputParts), 1130);
      playback.interrupt(1);
      if (!playback.enqueue(pcmTone(670, 0.75), 1)) throw new Error("Cannot queue new epoch");
      playback.turnComplete(1);
      await within((async () => { while (peak(Buffer.concat(outputParts), 670).score < .7) {
        if (failures.length) throw new Error("Audio pipeline failed");
        await sleep(80);
      } })(), 5000);
      await sleep(550);
      const after = Buffer.concat(outputParts);
      const newEpoch = peak(after, 670);
      const postFlush = peak(after, 1130, newEpoch.atMs * 24 + 2400);
      if (postFlush.score > .4 || captured <= before || failures.length) throw new Error("Flush/capture proof failed: " + JSON.stringify({ postFlush, newEpoch, capturedBefore: before, capturedAfter: captured, failures }));
      console.log(JSON.stringify({ mode: "fixture", ok: true, outputTail: tailProof,
        turnCompleteBeforeTail: completeAt > 0 && completeAt < Date.now(),
        queueDrained: queueDrainedAt > 0, oldBefore, postFlushOldTone: postFlush, newEpoch, captureContinued: captured > before }));
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
      await assertRoute("sink-inputs", speaker.pid!, endpoint(await listing("sinks"), mic));
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
