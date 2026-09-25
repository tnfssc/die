import { test, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { registerLiveStop, stopCurrentLive } from "../src/live/lifecycle-access";

test("live.stop awaits all matching CLI/web owners and ignores absent handlers", async () => {
  const pi = { events: new EventEmitter() } as any;
  const context = {} as any;
  let done!: () => void;
  registerLiveStop(pi, async () => undefined);
  registerLiveStop(pi, async () => {
    await new Promise<void>((resolve) => {
      done = resolve;
    });
    return { stopped: true, errors: [], jobsUnchanged: true };
  });
  registerLiveStop(pi, async () => ({ stopped: false, errors: ["provider close failed"], jobsUnchanged: true }));
  let completed = false;
  const result = stopCurrentLive(pi, context).then((result) => {
    completed = true;
    return result;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(completed).toBe(false);
  done();
  expect(await result).toEqual({ stopped: false, errors: ["provider close failed"], jobsUnchanged: true });
});

test("missing owners and thrown teardown do not claim success or expose errors", async () => {
  const pi = { events: new EventEmitter() } as any;
  expect((await stopCurrentLive(pi, {} as any)).stopped).toBe(false);
  registerLiveStop(pi, async () => {
    throw new Error("secret key detail");
  });
  expect(await stopCurrentLive(pi, {} as any)).toEqual({
    stopped: false,
    errors: ["Live lifecycle teardown failed"],
    jobsUnchanged: true,
  });
});
