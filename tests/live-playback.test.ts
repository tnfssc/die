import { describe, expect, test } from "bun:test";
import { FRAME_BYTES, MAX_PENDING_BYTES, type PlaybackClock, PlaybackScheduler } from "../src/live/playback";

class Clock implements PlaybackClock {
  time = 0;
  timerLateness = 0;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = ++this.next;
    this.timers.set(id, { at: this.time + ms + this.timerLateness, fn });
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
  for (let i = 0; i < 20; i++) await Promise.resolve();
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
describe("live playback scheduler", () => {
  test("played estimate excludes enqueue and pending writes; accrues only accepted playback time", async () => {
    let release!: () => void;
    const h = harness({
      send: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 2), 0);
    expect(h.scheduler.playedMs).toBe(0);
    h.scheduler.start();
    h.clock.advance(500);
    expect(h.scheduler.playedMs).toBe(0); // stalled pipe, not played
    release();
    await tick();
    expect(h.scheduler.playedMs).toBe(0); // success is not an audible ack
    h.clock.advance(10);
    expect(h.scheduler.playedMs).toBe(10);
    h.clock.advance(100);
    expect(h.scheduler.playedMs).toBe(20); // gap does not count as audio
    release();
    await tick();
    expect(h.scheduler.playedMs).toBe(20);
    h.clock.advance(8);
    expect(h.scheduler.playedMs).toBe(28);
    h.clock.advance(100);
    expect(h.scheduler.playedMs).toBe(40);
    h.scheduler.close();
    h.clock.advance(100);
    expect(h.scheduler.playedMs).toBe(40);
  });
  test("native ring feedback delays estimate, without moving it backwards", async () => {
    const h = harness();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 2), 0);
    h.scheduler.start();
    await tick();
    h.clock.advance(20);
    await tick();
    expect(h.scheduler.playedMs).toBe(20);
    h.scheduler.nativeQueued(80);
    expect(h.scheduler.playedMs).toBe(20);
    h.clock.advance(20);
    expect(h.scheduler.playedMs).toBe(20);
    h.clock.advance(60);
    expect(h.scheduler.playedMs).toBe(40);
  });
  test("interrupt resets estimate; old success and failed write never credit new epoch", async () => {
    let rejectOld!: (error: Error) => void;
    const h = harness({
      send: (_frame, epoch) =>
        epoch === 0
          ? new Promise((_resolve, reject) => {
              rejectOld = reject;
            })
          : Promise.resolve(),
    });
    h.scheduler.start();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 0);
    h.clock.advance(100);
    h.scheduler.interrupt(1);
    expect(h.scheduler.playedMs).toBe(0);
    rejectOld(new Error("cancelled"));
    await tick();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 1);
    await tick();
    expect(h.scheduler.playedMs).toBe(0);
    h.clock.advance(10);
    expect(h.scheduler.playedMs).toBe(10);
    h.scheduler.interrupt(2);
    expect(h.scheduler.playedMs).toBe(0);
    h.clock.advance(100);
    expect(h.scheduler.playedMs).toBe(0);
    const failed = harness({ send: () => Promise.reject(new Error("pipe failed")) });
    failed.scheduler.start();
    failed.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 0);
    await tick();
    failed.clock.advance(100);
    expect(failed.scheduler.playedMs).toBe(0);
    expect(failed.errors).toHaveLength(1);
  });
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
    for (const send of h.sent) {
      const totalMs = h.sent.filter((s) => s.at <= send.at).reduce((sum, s) => sum + s.frame.length / 48, 0);
      expect(totalMs).toBeLessThanOrEqual(send.at + 80);
    }
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
  test("native feedback only adds throttle; recovery after a stall is bounded to a cushion", async () => {
    const h = harness();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 200), 0);
    h.scheduler.start();
    await tick();
    expect(h.sent).toHaveLength(4);
    h.scheduler.nativeQueued(130);
    h.clock.advance(20);
    await tick();
    expect(h.sent).toHaveLength(4);
    h.clock.stall(1000);
    h.clock.advance(0);
    await tick();
    expect(h.sent).toHaveLength(8); // bounded reserve, not 51 overdue frames
    for (let i = 0; i < 100; i++) h.scheduler.nativeQueued(0);
    await tick();
    expect(h.sent).toHaveLength(8); // stale low snapshots cannot erase reservations
    h.clock.advance(20);
    await tick();
    expect(h.sent).toHaveLength(9);
  });
  for (const blockMs of [1, 10, 32]) {
    for (const feedback of ["none", "stale-zero", "delayed-coarse"]) {
      test("late timers keep reserve with " + blockMs + "ms native blocks and " + feedback, async () => {
        let queued = 0;
        let peak = 0;
        let empty = 0;
        let consumed = 0;
        const reports: { at: number; ms: number }[] = [];
        const h = harness({
          send: async (frame) => {
            queued += frame.length / 48;
            peak = Math.max(peak, queued);
          },
        });
        h.clock.timerLateness = 2;
        h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 200), 0);
        h.scheduler.turnComplete(0);
        h.scheduler.start();
        await tick();
        for (let time = 1; time <= 2200; time++) {
          // Native render callbacks consume in blocks independently of JS timers.
          if (time % blockMs === 0) {
            const used = Math.min(blockMs, queued);
            empty += blockMs - used;
            consumed += used;
            queued -= used;
          }
          h.clock.advance(1);
          if (feedback === "stale-zero") h.scheduler.nativeQueued(0);
          if (feedback === "delayed-coarse" && time % 40 === 0)
            reports.push({ at: time + 15, ms: Math.floor(queued / 10) * 10 });
          while (reports[0]?.at === time) h.scheduler.nativeQueued(reports.shift()!.ms);
          await tick();
          expect(h.scheduler.state.nativeQueuedMs).toBeLessThanOrEqual(80);
        }
        expect(empty).toBe(0);
        expect(consumed).toBe(Math.floor(2200 / blockMs) * blockMs);
        // Discrete render phase can hold up to one additional callback block.
        expect(peak).toBeLessThanOrEqual(80 + blockMs);
        expect(peak).toBeLessThan(1000);
        expect(h.scheduler.state.pendingBytes).toBeGreaterThan(0);
        expect(h.errors).toHaveLength(0);
      });
    }
  }
  test("low feedback racing write completion cannot create unbounded refill", async () => {
    const h = harness({
      send: async () => {
        h.scheduler.nativeQueued(0);
      },
    });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 200), 0);
    h.scheduler.start();
    await tick();
    expect(h.sent).toHaveLength(4);
    expect(h.scheduler.state.nativeQueuedMs).toBe(80);
    h.scheduler.interrupt(1); // cancel the scheduled refill immediately, even with a full cushion
    expect(h.flushed).toEqual([1]);
    expect(h.scheduler.state.pendingBytes).toBe(0);
    h.clock.advance(100);
    await tick();
    expect(h.sent).toHaveLength(4);
    h.scheduler.enqueue(Buffer.alloc(222, 7), 1);
    h.scheduler.turnComplete(1);
    await tick();
    expect(h.sent.at(-1)?.frame).toEqual(Buffer.alloc(222, 7));
    expect(h.sent.at(-1)?.epoch).toBe(1);
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
