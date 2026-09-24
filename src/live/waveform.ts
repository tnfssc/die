/** Compact PCM-driven footer meter. Levels describe buffered samples, not measured speaker output. */
export const WAVE_CELLS = 10;

/** Sample a bounded number of PCM16 little-endian samples; ignore invalid data. */
export function pcmLevel(pcm: Buffer): number {
  if (!pcm || pcm.length < 2) return 0;
  const count = Math.floor(pcm.length / 2);
  const stride = Math.max(1, Math.floor(count / 192));
  let peak = 0;
  for (let i = 0; i < count; i += stride) {
    const value = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
    if (Number.isFinite(value) && value > peak) peak = value;
  }
  return Math.min(1, peak);
}

/** Pure fixed-width braille renderer. 0 is quiet; phase only moves when there is signal. */
export function renderWave(level: number, phase = 0): string {
  const raw = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const strength = raw < 0.015 ? 0 : Math.min(1, Math.sqrt(raw) * 1.4);
  if (strength < 0.015) return "⠐".repeat(WAVE_CELLS);
  let result = "";
  for (let i = 0; i < WAVE_CELLS; i++) {
    const shape = 0.2 + 0.8 * Math.abs(Math.sin(i * 0.65 - phase * 0.45));
    const height = Math.max(1, Math.min(4, Math.ceil(strength * shape * 4)));
    // Braille rows are numbered 1,2,3,7 and 4,5,6,8 on left/right.
    const masks = [0, 0x12, 0x36, 0x77, 0xff];
    result += String.fromCodePoint(0x2800 + masks[height]);
  }
  return result;
}

export class LiveWaveform {
  private mic = 0;
  private output = 0;
  private shown = 0;
  private phase = 0;
  private outputUntil = 0;
  capture(pcm: Buffer) {
    this.mic = Math.max(this.mic, pcmLevel(pcm));
  }
  scheduled(pcm: Buffer, now: number, queuedMs: number) {
    this.output = pcmLevel(pcm);
    this.outputUntil = Math.max(this.outputUntil, now + Math.max(100, Number.isFinite(queuedMs) ? queuedMs : 0));
  }
  /** Extend only while native reports queued audio; this is an estimate, not an audible ACK. */
  queued(now: number, ms: number) {
    if (Number.isFinite(ms) && ms > 0) this.outputUntil = Math.max(this.outputUntil, now + ms);
  }
  resetOutput() {
    this.output = 0;
    this.outputUntil = 0;
    this.shown = 0;
  }
  tick(speaking: boolean, now: number): string {
    const target = speaking ? (now <= this.outputUntil ? this.output : 0) : this.mic;
    // Fast rise, soft fall. One peak per render interval, no stored PCM or frames.
    this.shown += (target - this.shown) * (target > this.shown ? 0.8 : 0.36);
    if (this.shown < 0.012) this.shown = 0;
    if (this.shown > 0.015) this.phase++;
    this.mic = 0; // Do not replay stale mic peaks after an assistant reply.
    if (now > this.outputUntil) this.output = 0;
    return renderWave(this.shown, this.phase);
  }
}
