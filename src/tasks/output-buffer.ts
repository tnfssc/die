const EMPTY = Buffer.alloc(0);

/**
 * A bounded FIFO of process output.
 *
 * Appends are O(1) in the common case. Old chunks are released as soon as the
 * byte limit is exceeded, avoiding repeated copies of the entire retained log.
 * Reads copy only the requested range.
 */
export class BoundedOutputBuffer {
  readonly #maxBytes: number;
  #chunks: Buffer[] = [];
  #head = 0;
  #retainedBytes = 0;
  #baseOffset = 0;
  #endOffset = 0;

  constructor(maxBytes: number) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive integer");
    this.#maxBytes = maxBytes;
  }

  get baseOffset(): number {
    return this.#baseOffset;
  }

  get endOffset(): number {
    return this.#endOffset;
  }

  get retainedBytes(): number {
    return this.#retainedBytes;
  }

  append(value: Buffer | string): void {
    let chunk = typeof value === "string" ? Buffer.from(value) : value;
    if (chunk.length === 0) return;

    this.#endOffset += chunk.length;

    // A single oversized write cannot fit. Copy only its tail so a giant
    // source slab is not kept alive by a small subarray.
    if (chunk.length >= this.#maxBytes) {
      this.#chunks = [Buffer.from(chunk.subarray(chunk.length - this.#maxBytes))];
      this.#head = 0;
      this.#retainedBytes = this.#maxBytes;
      this.#baseOffset = this.#endOffset - this.#maxBytes;
      return;
    }

    this.#chunks.push(chunk);
    this.#retainedBytes += chunk.length;
    this.#trim();

    // Pathological producers can emit thousands of tiny writes. Compact only
    // occasionally, keeping append cost amortized and chunk metadata bounded.
    if (this.#chunks.length - this.#head > 1024) this.#compact();
  }

  read(offset: number, limit: number): { buffer: Buffer; nextOffset: number; outputLost: boolean; hasMore: boolean } {
    const requestedOffset = Math.max(0, Math.trunc(offset));
    const effectiveOffset = Math.max(requestedOffset, this.#baseOffset);
    const available = Math.max(0, this.#endOffset - effectiveOffset);
    const requestedBytes = Math.min(Math.max(0, Math.trunc(limit)), available);
    if (requestedBytes === 0) {
      return {
        buffer: EMPTY,
        nextOffset: effectiveOffset,
        outputLost: requestedOffset < this.#baseOffset,
        hasMore: effectiveOffset < this.#endOffset,
      };
    }

    const parts: Buffer[] = [];
    let skip = effectiveOffset - this.#baseOffset;
    let remaining = requestedBytes;
    for (let index = this.#head; index < this.#chunks.length && remaining > 0; index++) {
      const chunk = this.#chunks[index];
      if (skip >= chunk.length) {
        skip -= chunk.length;
        continue;
      }
      const take = Math.min(remaining, chunk.length - skip);
      parts.push(chunk.subarray(skip, skip + take));
      remaining -= take;
      skip = 0;
    }

    const consumed = requestedBytes - remaining;
    const nextOffset = effectiveOffset + consumed;
    return {
      buffer: parts.length === 1 ? Buffer.from(parts[0]) : Buffer.concat(parts, consumed),
      nextOffset,
      outputLost: requestedOffset < this.#baseOffset,
      hasMore: nextOffset < this.#endOffset,
    };
  }

  #trim(): void {
    let overflow = this.#retainedBytes - this.#maxBytes;
    while (overflow > 0 && this.#head < this.#chunks.length) {
      const chunk = this.#chunks[this.#head];
      if (chunk.length <= overflow) {
        overflow -= chunk.length;
        this.#retainedBytes -= chunk.length;
        this.#baseOffset += chunk.length;
        this.#chunks[this.#head] = EMPTY;
        this.#head++;
      } else {
        this.#chunks[this.#head] = Buffer.from(chunk.subarray(overflow));
        this.#retainedBytes -= overflow;
        this.#baseOffset += overflow;
        overflow = 0;
      }
    }
    if (this.#head > 512) this.#compact();
  }

  #compact(): void {
    const retained = this.#chunks.slice(this.#head);
    this.#chunks = retained.length > 1 ? [Buffer.concat(retained, this.#retainedBytes)] : retained;
    this.#head = 0;
  }
}
