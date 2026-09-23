import { describe, expect, test } from "bun:test";
import { FRAME_BYTES, MAX_PENDING_BYTES, PlaybackScheduler, type PlaybackClock } from "../src/live-lab/playback";
class Clock implements PlaybackClock {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = ++this.next;
    this.timers.set(id, { at: this.time + ms, fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  }
  clearTimeout(id: ReturnType<typeof setTimeout>) {
    this.timers.delete(id as unknown as number);
  }
  advance(ms: number) {
    const end = this.time + ms;
    while (true) {
      let first: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= end && (!first || entry[1].at < first[1].at)) first = entry;
      if (!first) break;
      this.time = Math.max(this.time, first[1].at);
      this.timers.delete(first[0]);
      first[1].fn();
    }
    this.time = end;
  }
  stall(ms: number) {
    this.time += ms;
  }
}
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function harness(
  overrides: {
    send?: (frame: Buffer, epoch: number) => Promise<void>;
    flush?: (epoch: number) => Promise<void>;
    maxPendingBytes?: number;
  } = {},
) {
  const clock = new Clock();
  const sent: { frame: Buffer; epoch: number; at: number }[] = [];
  const flushed: number[] = [];
  const errors: Error[] = [];
  const scheduler = new PlaybackScheduler({
    clock,
    maxPendingBytes: overrides.maxPendingBytes,
    send(frame, epoch) {
      sent.push({ frame, epoch, at: clock.now() });
      return overrides.send?.(frame, epoch) ?? Promise.resolve();
    },
    flush(epoch) {
      flushed.push(epoch);
      return overrides.flush?.(epoch) ?? Promise.resolve();
    },
    onError: (error) => errors.push(error),
  });
  return { clock, sent, flushed, errors, scheduler };
}
describe("live-lab playback scheduler", () => {
  test("burst of seconds drains at wall time; turnComplete retains every sample including fractional tail", async () => {
    const h = harness();
    const pcm = Buffer.alloc(48_000 * 4 + 222);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i % 251;
    pcm.writeInt16LE(12345, pcm.length - 2);
    for (let i = 0; i < pcm.length; i += 48000) expect(h.scheduler.enqueue(pcm.subarray(i, i + 48000), 0)).toBe(true);
    h.scheduler.turnComplete(0);
    expect(h.sent).toHaveLength(0); // native not ready
    h.scheduler.start();
    expect(h.sent).toHaveLength(1); // immediate first frame
    for (let i = 0; i < 250; i++) {
      await tick();
      h.clock.advance(20);
    }
    expect(Buffer.concat(h.sent.map((s) => s.frame))).toEqual(pcm);
    expect(h.scheduler.state.pendingBytes).toBe(0);
    expect(h.sent.at(-1)?.frame.length).toBe(222);
    for (let i = 1; i < h.sent.length; i++) expect(h.sent[i]!.at - h.sent[i - 1]!.at).toBeGreaterThanOrEqual(20);
    expect(h.errors).toHaveLength(0);
  });
  test("turn boundaries do not flush; partial chunks join, but adjacent turns remain distinct", async () => {
    const h = harness();
    h.scheduler.start();
    const first = Buffer.alloc(FRAME_BYTES + 100, 1);
    h.scheduler.enqueue(first.subarray(0, 502), 0);
    h.scheduler.enqueue(first.subarray(502), 0);
    h.scheduler.turnComplete(0);
    h.scheduler.enqueue(Buffer.alloc(200, 2), 0);
    h.scheduler.turnComplete(0);
    for (let i = 0; i < 4; i++) {
      await tick();
      h.clock.advance(20);
    }
    expect(h.sent.map((s) => s.frame.length)).toEqual([960, 100, 200]);
    expect(h.flushed).toHaveLength(0);
  });
  test("native queue measurements throttle output and no catch-up bursts after event-loop stall", async () => {
    const h = harness();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 20), 0);
    h.scheduler.start();
    await tick();
    h.scheduler.nativeQueued(130);
    h.clock.advance(20);
    await tick();
    expect(h.sent).toHaveLength(1);
    h.clock.stall(1000);
    h.clock.advance(0);
    await tick();
    expect(h.sent).toHaveLength(2);
    h.clock.advance(0);
    await tick();
    expect(h.sent).toHaveLength(2);
    h.clock.advance(20);
    await tick();
    expect(h.sent).toHaveLength(3);
    expect(Math.max(...h.sent.map((s) => s.frame.length))).toBe(960);
  });
  test("interrupt discards unsent old generation, native flush gates new output; stale write rejection harmless", async () => {
    let rejectOld!: (error: Error) => void;
    let resolveFlush!: () => void;
    const h = harness({
      send: (_frame, epoch) =>
        epoch === 0
          ? new Promise((_resolve, reject) => {
              rejectOld = reject;
            })
          : Promise.resolve(),
      flush: () =>
        new Promise((resolve) => {
          resolveFlush = resolve;
        }),
    });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 4, 1), 0);
    h.scheduler.start();
    h.scheduler.interrupt(1);
    expect(h.flushed).toEqual([1]);
    expect(h.scheduler.state.pendingBytes).toBe(0);
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES, 2), 1);
    rejectOld(new Error("Audio playback interrupted"));
    await tick();
    expect(h.errors).toHaveLength(0);
    expect(h.sent).toHaveLength(1);
    resolveFlush();
    await tick();
    expect(h.sent.map((s) => s.epoch)).toEqual([0, 1]);
    expect(h.sent[1]?.frame).toEqual(Buffer.alloc(FRAME_BYTES, 2));
  });
  test("pending budget is large enough for long replies; exceeded bound reports once, no silent drop", () => {
    const h = harness();
    expect(h.scheduler.enqueue(Buffer.alloc(MAX_PENDING_BYTES), 0)).toBe(true);
    expect(h.scheduler.enqueue(Buffer.alloc(2), 0)).toBe(false);
    expect(h.scheduler.enqueue(Buffer.alloc(2), 0)).toBe(false);
    expect(h.errors).toHaveLength(1);
    expect(h.scheduler.state.pendingBytes).toBe(MAX_PENDING_BYTES);
    h.scheduler.interrupt(1);
    expect(h.scheduler.enqueue(Buffer.alloc(2), 1)).toBe(true);
  });
  test("stalled pipe write does not start extra writes and stop prevents future output", async () => {
    let release!: () => void;
    const h = harness({
      send: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 5), 0);
    h.scheduler.start();
    h.clock.stall(3000);
    h.clock.advance(0);
    await tick();
    expect(h.sent).toHaveLength(1);
    release();
    await tick();
    expect(h.sent).toHaveLength(2); // only one after stall
    h.scheduler.close();
    h.clock.advance(5000);
    await tick();
    expect(h.sent).toHaveLength(2);
    expect(h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 0)).toBe(false);
    const other = harness();
    other.scheduler.close();
    other.scheduler.start();
    expect(other.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 0)).toBe(false);
    expect(other.sent).toHaveLength(0);
  });
  test("pre-ready interruption flushes before first new frame and close during flush cancels output", async () => {
    let release!: () => void;
    const h = harness({
      flush: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES, 1), 0);
    h.scheduler.interrupt(1);
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES, 2), 1);
    h.scheduler.start();
    expect(h.flushed).toEqual([1]);
    expect(h.sent).toHaveLength(0);
    h.scheduler.close();
    release();
    await tick();
    expect(h.sent).toHaveLength(0);
  });
  test("flush failure is visible and cannot send audio until another interruption", async () => {
    const h = harness({
      flush: (epoch) => (epoch === 1 ? Promise.reject(new Error("flush failed")) : Promise.resolve()),
    });
    h.scheduler.start();
    h.scheduler.interrupt(1);
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 1);
    await tick();
    expect(h.errors).toHaveLength(1);
    expect(h.sent).toHaveLength(0);
    h.scheduler.interrupt(2);
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 2);
    await tick();
    expect(h.sent.map((s) => s.epoch)).toEqual([2]);
  });
});
