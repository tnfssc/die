export type Phase = 'idle' | 'requesting-mic' | 'connecting' | 'ready' | 'muted' | 'interrupted' | 'ended' | 'error';
export type LiveState = { phase: Phase; reason?: string };
// All PCM is binary, signed 16-bit little-endian mono. Capture: 16kHz; playback: 24kHz.
export interface Capture { onPcm16(cb: (frame: Uint8Array) => void): () => void; stop(): void }
export interface MediaSource { acquire16k(): Promise<Capture> }
export interface AudioOutput { readonly queuedBytes: number; enqueue24k(frame: Uint8Array): void; clear(): void; stop(): void }
export type TransportMessage = { type: 'ready' | 'interrupted' } | { type: 'audio'; pcm16: Uint8Array } | { type: 'closed' | 'error'; reason?: string };
export interface Transport { readonly queuedBytes: number; onMessage(cb: (message: TransportMessage) => void): () => void; send16k(frame: Uint8Array): void; close(): void }
export interface TransportFactory { connect(): Promise<Transport> }
const FRAME_LIMIT = 65536, INPUT_LIMIT = 262144, OUTPUT_LIMIT = 524288;

/** Lifecycle owner. Adapters must bound their own queues, copy retained frames and make stop/close idempotent. */
export class BrowserLiveController {
  private value: LiveState = { phase: 'idle' };
  private generation = 0;
  private disposed = false;
  private muted = false;
  private capture?: Capture;
  private transport?: Transport;
  private output?: AudioOutput;
  private offCapture?: () => void;
  private offTransport?: () => void;
  private listeners = new Set<(state: LiveState) => void>();
  constructor(private media: MediaSource, private network: TransportFactory, private audio: () => AudioOutput) {}
  get state(): LiveState { return this.value }
  subscribe(cb: (state: LiveState) => void): () => void { this.listeners.add(cb); cb(this.value); return () => { this.listeners.delete(cb) } }
  private setState(phase: Phase, reason?: string): void { this.value = { phase, ...(reason ? { reason } : {}) }; for (const cb of [...this.listeners]) cb(this.value) }
  private active(id: number): boolean { return !this.disposed && this.generation === id }
  /** Resolves after setup; only the server's ready message makes the session ready. */
  async start(): Promise<void> {
    if (this.disposed) throw new Error('disposed');
    if (!['idle','ended','error'].includes(this.value.phase)) throw new Error('already started');
    const id = ++this.generation;
    this.muted = false;
    this.setState('requesting-mic');
    if (!this.active(id)) return;
    try {
      const capture = await this.media.acquire16k();
      if (!this.active(id)) { capture.stop(); return }
      this.capture = capture;
      this.output = this.audio();
      if (!this.active(id)) return;
      this.setState('connecting');
      if (!this.active(id)) return;
      const transport = await this.network.connect();
      if (!this.active(id)) { transport.close(); return }
      this.transport = transport;
      const offTransport = transport.onMessage(message => this.receive(id, message));
      if (!this.active(id)) { offTransport(); return }
      this.offTransport = offTransport;
      const offCapture = capture.onPcm16(frame => this.input(id, frame));
      if (!this.active(id)) { offCapture(); return }
      this.offCapture = offCapture;
    } catch (error) { if (this.active(id)) this.fail(error) }
  }
  setMuted(muted: boolean): void {
    if (!['ready','muted','interrupted'].includes(this.value.phase)) return;
    this.muted = muted;
    if (this.value.phase !== 'interrupted') this.setState(muted ? 'muted' : 'ready');
  }
  private valid(frame: Uint8Array): void {
    if (!(frame instanceof Uint8Array) || !frame.byteLength || frame.byteLength % 2 || frame.byteLength > FRAME_LIMIT) throw new Error('invalid PCM16 frame');
  }
  private input(id: number, frame: Uint8Array): void {
    if (!this.active(id) || this.muted || this.value.phase !== 'ready') return;
    try {
      this.valid(frame);
      if (this.transport!.queuedBytes + frame.byteLength > INPUT_LIMIT) throw new Error('input queue full');
      this.transport!.send16k(frame);
    } catch (error) { this.fail(error) }
  }
  private receive(id: number, message: TransportMessage): void {
    if (!this.active(id)) return;
    try {
      switch (message.type) {
        case 'ready': this.setState(this.muted ? 'muted' : 'ready'); break;
        case 'interrupted': this.output?.clear(); this.setState('interrupted'); break;
        case 'audio':
          if (!['ready','muted'].includes(this.value.phase)) return;
          this.valid(message.pcm16);
          if (this.output!.queuedBytes + message.pcm16.byteLength > OUTPUT_LIMIT) throw new Error('output buffer full');
          this.output!.enqueue24k(message.pcm16);
          break;
        case 'closed': case 'error': this.fail(message.reason ?? 'transport disconnected'); break;
      }
    } catch (error) { if (this.active(id)) this.fail(error) }
  }
  private fail(error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    ++this.generation;
    this.cleanup();
    this.setState('error', reason);
  }
  private cleanup(): void {
    const capture = this.capture, output = this.output, transport = this.transport;
    const releases = [this.offCapture, this.offTransport, () => capture?.stop(), () => output?.stop(), () => transport?.close()];
    this.offCapture = this.offTransport = undefined;
    this.capture = undefined; this.output = undefined; this.transport = undefined;
    // Snapshot resources before clearing ownership (above).
    for (const release of releases) { try { release?.() } catch { /* continue cleanup */ } }
  }
  end(): void { if (this.disposed || this.value.phase === 'ended') return; ++this.generation; this.cleanup(); this.setState('ended') }
  dispose(): void { if (this.disposed) return; this.end(); this.disposed = true; this.listeners.clear() }
}
