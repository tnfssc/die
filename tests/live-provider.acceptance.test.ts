import { expect, test } from "bun:test";
import { loadLiveKey } from "../src/live/credentials";
import { LIVE_MODEL, LiveTransport, type LiveCall } from "../src/live/transport";

const enabled = process.env.DIE_RUN_GEMINI_LIVE_ACCEPTANCE === "1";
const acceptance = enabled ? test : test.skip;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function synthesizeSpeech(text: string): Buffer {
  const speech = Bun.spawnSync(["espeak-ng", "--stdout", text], { stdout: "pipe", stderr: "pipe" });
  if (speech.exitCode !== 0) throw new Error("Local synthetic speech generation failed.");
  const converted = Bun.spawnSync(
    ["sox", "-t", "wav", "-", "-r", "16000", "-c", "1", "-e", "signed-integer", "-b", "16", "-t", "raw", "-", "gain", "6"],
    { stdin: speech.stdout, stdout: "pipe", stderr: "pipe" },
  );
  if (converted.exitCode !== 0) throw new Error("Local synthetic speech conversion failed.");
  return Buffer.from(converted.stdout);
}

async function sendSyntheticTurn(transport: LiveTransport, pcm: Buffer): Promise<void> {
  const leadingSilence = Buffer.alloc(16_000);
  const trailingSilence = Buffer.alloc(64_000); // Two seconds gives automatic VAD an unambiguous turn boundary.
  const turn = Buffer.concat([leadingSilence, pcm, trailingSilence]);
  for (let offset = 0; offset < turn.length; offset += 3_200) {
    transport.sendAudio(turn.subarray(offset, Math.min(offset + 3_200, turn.length)).toString("base64"));
    await wait(100);
  }
  transport.endAudio();
}

acceptance(
  "real Gemini Live accepts setup, synthetic speech, NON_BLOCKING handoff responses, and continues audio",
  async () => {
    const key = await loadLiveKey();
    const spoken = synthesizeSpeech(
      "Use handoff now. Tell the coding agent to verify blue seven.",
    );
    const evidence = {
      model: LIVE_MODEL,
      setupAccepted: false,
      handoffToolCallReceived: false,
      toolArgsContainedRequest: false,
      inputTranscriptReceived: false,
      handoffRequestedAfterAudioAcceptance: false,
      continuingResponseSent: false,
      finalResponseSent: false,
      outputAudioPackets: 0,
      outputAudioBytes: 0,
      outputAfterContinuingResponse: false,
      interrupted: false,
      closed: "",
    };
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => (resolveDone = resolve));
    let transport!: LiveTransport;
    let started = false;
    let sentHandoffTurn = false;
    const requestHandoff = () => {
      if (sentHandoffTurn || !evidence.inputTranscriptReceived || evidence.outputAudioPackets === 0) return;
      sentHandoffTurn = true;
      evidence.handoffRequestedAfterAudioAcceptance = true;
      transport.sendTextTurn("Call handoff now with request: verify the acceptance token blue seven.");
    };
    const callbacks = {
      ready: () => {
        evidence.setupAccepted = true;
        if (!started) {
          started = true;
          void sendSyntheticTurn(transport, spoken);
        }
      },
      audio: (data: string) => {
        evidence.outputAudioPackets++;
        evidence.outputAudioBytes += Buffer.from(data, "base64").length;
        if (evidence.continuingResponseSent) evidence.outputAfterContinuingResponse = true;
        if (evidence.outputAfterContinuingResponse && evidence.finalResponseSent) resolveDone();
        setTimeout(requestHandoff, 300);
      },
      inputTranscript: (text: string) => {
        if (text.trim()) {
          evidence.inputTranscriptReceived = true;
          setTimeout(requestHandoff, 300);
        }
      },
      interrupted: () => {
        evidence.interrupted = true;
      },
      call: (call: LiveCall) => {
        if (call.name !== "handoff") return;
        evidence.handoffToolCallReceived = true;
        evidence.toolArgsContainedRequest = typeof call.args.request === "string" && call.args.request.length > 0;
        transport.respond(
          call.id,
          { status: "queued", requestId: "synthetic-acceptance", note: "Queued is not completion." },
          true,
          "SILENT",
        );
        evidence.continuingResponseSent = true;
        setTimeout(() => {
          transport.respond(
            call.id,
            { event: { type: "accepted", requestId: "synthetic-acceptance" }, note: "Accepted, not completed." },
            true,
            "WHEN_IDLE",
          );
          setTimeout(() => {
            transport.respond(
              call.id,
              { event: { type: "run_ended", requestId: "synthetic-acceptance" }, note: "Observation ended." },
              false,
              "WHEN_IDLE",
            );
            evidence.finalResponseSent = true;
            if (evidence.outputAfterContinuingResponse) resolveDone();
          }, 1_000);
        }, 500);
      },
      cancelled: () => {},
      closed: (reason: string) => {
        evidence.closed = reason;
        resolveDone();
      },
    };
    transport = new LiveTransport(callbacks);
    const deadline = setTimeout(resolveDone, 30_000);
    try {
      transport.connect(key);
      await done;
    } finally {
      clearTimeout(deadline);
      transport.close();
    }

    // This is deliberately the only output: bounded evidence with no messages, URLs, headers, or credentials.
    console.log("Gemini Live acceptance evidence " + JSON.stringify(evidence));
    expect(evidence.closed).toBe("");
    expect(evidence.setupAccepted).toBe(true);
    expect(evidence.inputTranscriptReceived).toBe(true);
    expect(evidence.handoffRequestedAfterAudioAcceptance).toBe(true);
    expect(evidence.handoffToolCallReceived).toBe(true);
    expect(evidence.toolArgsContainedRequest).toBe(true);
    expect(evidence.outputAudioPackets).toBeGreaterThan(0);
    expect(evidence.outputAudioBytes).toBeGreaterThan(0);
    expect(evidence.continuingResponseSent).toBe(true);
    expect(evidence.finalResponseSent).toBe(true);
    expect(evidence.outputAfterContinuingResponse).toBe(true);
  },
  35_000,
);
