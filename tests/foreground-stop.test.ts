import { expect, test } from "bun:test";
import { requestForegroundStop } from "../src/tasks/foreground-stop";
import { JOB_RESPONSE_ACK_EVENT } from "../src/typescript/job-bridge";
function fixture() {
  let idle = false,
    session = "owned",
    leaf = "leaf",
    aborted = 0,
    fail = false;
  const controller = new AbortController();
  Object.defineProperty(controller.signal, Symbol.for("die.job-response-ack-capable"), { value: true });
  const observed: unknown[] = [];
  const ctx = {
    isIdle: () => idle,
    abort: () => {
      aborted++;
      if (fail) throw Error("secret");
    },
    sessionManager: { getSessionId: () => session, getLeafId: () => leaf },
  } as any;
  return {
    controller,
    observed,
    ctx,
    start: () => requestForegroundStop(ctx, controller.signal, (r) => observed.push(r)),
    ack: () => controller.signal.dispatchEvent(new Event(JOB_RESPONSE_ACK_EVENT)),
    aborted: () => aborted,
    idle: () => (idle = true),
    change: () => (session = "foreign"),
    fail: () => (fail = true),
  };
}
test("foreground stop waits for execute response ACK and does not claim abort means completion", () => {
  const f = fixture();
  expect(f.start().outcome).toBe("pending");
  expect(f.aborted()).toBe(0);
  f.ack();
  expect(f.aborted()).toBe(1);
  expect(f.observed).toEqual([{ outcome: "pending" }]);
  f.ack();
  expect(f.aborted()).toBe(1);
});
test("foreground stop does not cross session or cancelled delivery and surfaces errors", () => {
  const foreign = fixture();
  foreign.start();
  foreign.change();
  foreign.ack();
  expect(foreign.aborted()).toBe(0);
  expect(foreign.observed[0]).toMatchObject({ outcome: "error" });
  const cancelled = fixture();
  cancelled.start();
  cancelled.controller.abort();
  cancelled.ack();
  expect(cancelled.aborted()).toBe(0);
  const failed = fixture();
  failed.start();
  failed.fail();
  failed.ack();
  expect(failed.observed[0]).toMatchObject({ outcome: "error" });
  const idle = fixture();
  idle.idle();
  expect(idle.start()).toEqual({ outcome: "idle" });
  idle.ack();
  expect(idle.aborted()).toBe(0);
});
