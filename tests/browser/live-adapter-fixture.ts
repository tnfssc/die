import { browserAudioOutput, browserMediaSource, browserTransportFactory } from "../../web/live/device-adapters";

const button = document.querySelector<HTMLButtonElement>("#start")!;
const state: Record<string, unknown> = { phase: "idle", frames: 0, bytes: 0 };
Object.assign(window, { adapterProof: state });
button.addEventListener("click", async () => {
  button.disabled = true;
  state.phase = "running";
  let capture: any, output: ReturnType<typeof browserAudioOutput> | undefined, transport: any;
  try {
    const devices = navigator.mediaDevices;
    const nativeGetUserMedia = devices.getUserMedia.bind(devices);
    let activeStream: MediaStream | undefined;
    Object.defineProperty(devices, "getUserMedia", { configurable: true, value: async (constraints: MediaStreamConstraints) => { activeStream = await nativeGetUserMedia(constraints); return activeStream; } });
    capture = await browserMediaSource().acquire16k(new AbortController().signal);
    const probe = new AudioContext();
    state.contextSampleRate = probe.sampleRate;
    await probe.close();
    const rates: number[] = [];
    capture.onPcm16((frame: Uint8Array) => {
      state.frames = (state.frames as number) + 1;
      state.bytes = (state.bytes as number) + frame.byteLength;
      if (rates.length < 2) rates.push(new DataView(frame.buffer).getInt16(0, true));
      transport?.send16k(frame);
    });
    state.firstSamples = rates;
    output = browserAudioOutput();
    const out = output;
    transport = await browserTransportFactory("/relay").connect(new AbortController().signal);
    const types: string[] = [];
    state.messages = types;
    transport.onMessage((message: any) => {
      types.push(message.type);
      if (message.type === "audio") {
        state.receivedAudioBytes = message.pcm16.byteLength;
        out.enqueue24k(message.pcm16);
        state.queueBeforeClear = out.queuedBytes;
      }
      if (message.type === "interrupted") {
        out.clear();
        state.queueAfterClear = out.queuedBytes;
      }
    });
    await new Promise(resolve => setTimeout(resolve, 650));
    // Permission resolving AFTER abort releases even a real fake-device stream.
    const original = nativeGetUserMedia;
    let release!: (stream: MediaStream) => void;
    const delayed = new Promise<MediaStream>(resolve => { release = resolve; });
    Object.defineProperty(devices, "getUserMedia", { configurable: true, value: () => delayed });
    try {
      const lateAbort = new AbortController();
      const pending = browserMediaSource().acquire16k(lateAbort.signal);
      lateAbort.abort();
      const lateStream = await original({ audio: true });
      release(lateStream);
      try { await pending; throw new Error("late permission unexpectedly succeeded"); }
      catch (error) { if ((error as Error).name !== "AbortError") throw error; }
      state.lateTracksEnded = lateStream.getTracks().every(t => t.readyState === "ended");
    } finally { Object.defineProperty(devices, "getUserMedia", { configurable: true, value: original }); }
    const pendingAbort = new AbortController();
    const pendingSocket = browserTransportFactory("/pending").connect(pendingAbort.signal);
    pendingAbort.abort();
    try { await pendingSocket; throw new Error("aborted socket unexpectedly opened"); }
    catch (error) { if ((error as Error).name !== "AbortError") throw error; }
    state.pendingSocketAborted = true;
    transport.close();
    capture.stop(); output.stop();
    state.captureTracksEnded = activeStream?.getTracks().every(t => t.readyState === "ended");
    await Promise.all([capture.closed, output.closed]);
    state.captureClosed = true;
    state.outputClosed = true;
    state.phase = "done";
  } catch (error) {
    state.phase = "error"; state.error = String(error);
    transport?.close(); capture?.stop(); output?.stop();
  }
});
