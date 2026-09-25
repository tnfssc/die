import type { AudioOutput, Capture, MediaSource, Transport, TransportFactory, TransportMessage } from "./controller";
import { decodeRelayMessage } from "./protocol";

// Integrate hardware samples over 16k sample intervals, even at 44.1kHz.
// Audio render callbacks alone drive capture; no idle timer or animation loop.
export const CAPTURE_PROCESSOR = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.phase = 0; this.sum = 0; this.frame = new Uint8Array(640); this.index = 0; }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    const width = 16000 / sampleRate;
    for (let i = 0; i < input.length; i++) {
      let left = width;
      const value = Number.isFinite(input[i]) ? input[i] : 0;
      while (left > 1e-10) {
        const part = Math.min(left, 1 - this.phase);
        this.sum += value * part; this.phase += part; left -= part;
        if (this.phase >= 1 - 1e-10) {
          const sample = Math.max(-1, Math.min(1, this.sum));
          const pcm = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
          this.frame[this.index++] = pcm & 255; this.frame[this.index++] = (pcm >> 8) & 255;
          if (this.index === this.frame.length) {
            this.port.postMessage(this.frame, [this.frame.buffer]);
            this.frame = new Uint8Array(640); this.index = 0;
          }
          this.phase = 0; this.sum = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('die-pcm-capture', PcmCapture);
`;

/** Must be called only after a deliberate user action (the controller's start()). */
export function browserMediaSource(): MediaSource {
  return {
    async acquire16k(signal: AbortSignal): Promise<Capture> {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      // getUserMedia cannot be cancelled: release a late stream immediately.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      let context: AudioContext | undefined;
      let source: MediaStreamAudioSourceNode | undefined;
      let node: AudioWorkletNode | undefined;
      let silence: GainNode | undefined;
      let stopped = false;
      let closed: Promise<void> = Promise.resolve();
      let listener: ((frame: Uint8Array) => void) | undefined;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        listener = undefined;
        if (node) node.port.onmessage = null;
        node?.port.close();
        source?.disconnect();
        node?.disconnect();
        silence?.disconnect();
        for (const track of stream.getTracks()) track.stop();
        if (context) {
          closed = context.close();
          void closed.catch(() => {});
        }
      };
      try {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        context = new AudioContext();
        const url = URL.createObjectURL(new Blob([CAPTURE_PROCESSOR], { type: "text/javascript" }));
        try {
          await context.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        source = context.createMediaStreamSource(stream);
        node = new AudioWorkletNode(context, "die-pcm-capture");
        silence = context.createGain();
        silence.gain.value = 0;
        node.port.onmessage = (event: MessageEvent<Uint8Array>) => {
          if (!stopped && event.data instanceof Uint8Array && event.data.byteLength === 640)
            listener?.(event.data.slice());
        };
        source.connect(node);
        node.connect(silence);
        silence.connect(context.destination);
        await context.resume();
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        return {
          onPcm16(cb) {
            listener = cb;
            return () => {
              if (listener === cb) listener = undefined;
            };
          },
          stop,
          // The controller currently cannot await stop(); callers needing verified release can await this.
          get closed() {
            return closed;
          },
        } as Capture & { readonly closed: Promise<void> };
      } catch (error) {
        stop();
        await closed.catch(() => {});
        throw error;
      }
    },
  };
}

/** PCM16LE 24kHz, scheduled on the audio clock. Stop/clear cut currently playing speech. */
export function browserAudioOutput(): AudioOutput & { readonly closed: Promise<void> } {
  const context = new AudioContext();
  const playing = new Set<AudioBufferSourceNode>();
  let endTime = context.currentTime;
  let stopped = false;
  let closed: Promise<void> = Promise.resolve();
  const clear = () => {
    for (const source of playing) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    playing.clear();
    endTime = context.currentTime;
  };
  return {
    get queuedBytes() {
      return stopped ? 0 : Math.max(0, Math.ceil((endTime - context.currentTime) * 48000));
    },
    enqueue24k(frame) {
      if (stopped) throw new Error("audio output stopped");
      if (!frame.byteLength || frame.byteLength % 2 || frame.byteLength > 9600) throw new Error("Invalid output frame");
      if (Math.max(0, endTime - context.currentTime) * 48000 + frame.byteLength > 12000)
        throw new Error("output buffer full");
      const buffer = context.createBuffer(1, frame.byteLength / 2, 24000);
      const samples = buffer.getChannelData(0);
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        playing.delete(source);
        source.disconnect();
      };
      const start = Math.max(context.currentTime, endTime);
      source.start(start);
      playing.add(source);
      endTime = start + buffer.duration;
    },
    clear,
    stop() {
      if (stopped) return;
      stopped = true;
      clear();
      closed = context.close();
      void closed.catch(() => {});
    },
    get closed() {
      return closed;
    },
  };
}

/** Dedicated same-origin relay endpoint; no credentials/provider keys in socket messages. */
export function browserTransportFactory(path: string): TransportFactory {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("#"))
    throw new Error("Expected same-origin relay path");
  return {
    connect(signal): Promise<Transport> {
      if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      const url = new URL(path, location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url.href);
      socket.binaryType = "arraybuffer";
      return new Promise((resolve, reject) => {
        let active = true;
        let opened = false;
        let callback: ((message: TransportMessage) => void) | undefined;
        const close = () => {
          if (!active) return;
          active = false;
          signal.removeEventListener("abort", abort);
          socket.onmessage = socket.onclose = socket.onerror = socket.onopen = null;
          socket.close();
        };
        const abort = () => {
          close();
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          abort();
          return;
        }
        socket.onerror = () => {
          if (!active) return;
          if (!opened) {
            close();
            reject(new Error("Voice socket failed"));
          } else callback?.({ type: "error", reason: "Voice socket failed" });
        };
        socket.onclose = () => {
          if (!active) return;
          if (!opened) {
            close();
            reject(new Error("Voice socket closed"));
          } else {
            callback?.({ type: "closed" });
            close();
          }
        };
        socket.onopen = () => {
          if (!active) return;
          opened = true;
          resolve({
            get queuedBytes() {
              return socket.bufferedAmount;
            },
            onMessage(cb) {
              callback = cb;
              return () => {
                if (callback === cb) callback = undefined;
              };
            },
            send16k(frame) {
              if (!active || socket.readyState !== WebSocket.OPEN) throw new Error("Voice socket closed");
              if (
                !frame.byteLength ||
                frame.byteLength > 3200 ||
                frame.byteLength % 2 ||
                socket.bufferedAmount + frame.byteLength > 6400
              )
                throw new Error("Input buffer full");
              socket.send(frame.slice());
            },
            sendControl(control) {
              if (!active || socket.readyState !== WebSocket.OPEN) throw new Error("Voice socket closed");
              socket.send(JSON.stringify(control));
            },
            close,
          });
        };
        socket.onmessage = (event) => {
          if (!active) return;
          try {
            callback?.(decodeRelayMessage(event.data));
          } catch {
            callback?.({ type: "error", reason: "Invalid voice message" });
          }
        };
      });
    },
  };
}
