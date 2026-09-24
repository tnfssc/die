/** Stateful linear PCM16 mono 16k -> 24k conversion. Exact rational phase, no chunk-boundary duplication. */
export class InputResampler {
  private previous = 0;
  private count = 0;
  private next = 0;
  push(input: Uint8Array): Uint8Array {
    if (input.length % 2) throw new Error("Odd PCM byte count");
    const samples = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const out: number[] = [];
    for (let i = 0; i < input.length / 2; i++) {
      const current = samples.getInt16(i * 2, true);
      const at = this.count++;
      if (at) {
        while (this.next <= at * 3) {
          const base = Math.floor(this.next / 3);
          const fraction = (this.next % 3) / 3;
          // next is measured in thirds of an input sample (3 output samples per 2 input).
          const position = this.next / 3;
          if (position < at - 1) throw new Error("Resampler phase lost");
          const value = Math.round(this.previous + (current - this.previous) * (position - (at - 1)));
          out.push(Math.max(-32768, Math.min(32767, value)));
          this.next += 2;
        }
      } else {
        out.push(current);
        this.next = 2;
      }
      this.previous = current;
    }
    const bytes = new Uint8Array(out.length * 2);
    const view = new DataView(bytes.buffer);
    out.forEach((value, i) => view.setInt16(i * 2, value, true));
    return bytes;
  }
  /** One final held sample where linear interpolation needs a future frame. */
  flush(): Uint8Array {
    const out = new Uint8Array(this.count && this.next < this.count * 3 ? 2 : 0);
    if (out.length) new DataView(out.buffer).setInt16(0, this.previous, true);
    this.reset();
    return out;
  }
  reset(): void {
    this.count = 0;
    this.next = 0;
    this.previous = 0;
  }
}
