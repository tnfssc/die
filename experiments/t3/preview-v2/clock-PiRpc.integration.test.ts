import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { makePiRpcConnection } from "./PiRpc.ts";

interface EventRow { readonly event: string; readonly pid: number; readonly childPid?: number; readonly code?: number | null }
const launcher = resolve(process.cwd(), "../../clock-launcher.mjs");
const die = resolve(process.cwd(), "../../../../dist/die");

async function rows(file: string): Promise<ReadonlyArray<EventRow>> {
  try {
    return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function waitFor(file: string, predicate: (events: ReadonlyArray<EventRow>) => boolean, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await rows(file);
    if (predicate(events)) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for sanitized launcher lifecycle evidence");
}

const fixture = Effect.acquireRelease(
  Effect.promise(async () => {
    const root = await mkdtemp(resolve(tmpdir(), "pi-rpc-clock-"));
    return { root, events: resolve(root, "events.jsonl") };
  }),
  ({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

function open(events: string, root: string) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const scope = yield* Scope.make();
    const connection = yield* makePiRpcConnection({
      command: process.execPath,
      args: [launcher, "--mode", "rpc", "--no-context-files"],
      cwd: resolve(process.cwd(), "../../../.."),
      env: {
        ...process.env,
        HOME: root,
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        DIE_CODING_AGENT_DIR: resolve(root, "agent"),
        CLOCK_DIE_BIN: die,
        CLOCK_EVENTS: events,
      },
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(Scope.Scope, scope),
    );
    yield* Effect.promise(() => waitFor(events, (xs) => xs.some((x) => x.event === "die-start")));
    yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)));
    return { connection, scope };
  });
}


function closed(scope: Scope.CloseableScope) {
  return Scope.close(scope, Exit.void);
}

describe("PiRpc causal teardown clock proof", () => {
  it.effect("keeps the real process teardown pending on the frozen TestClock until adjusted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const { scope } = yield* open(f.events, f.root);
        const closeFiber = yield* closed(scope).pipe(Effect.forkChild);
        const evidence = yield* Effect.promise(() =>
          waitFor(f.events, (xs) =>
            xs.some((x) => x.event === "sigterm") &&
            xs.some((x) => x.event === "die-exit") &&
            xs.some((x) => x.event === "launcher-exit"),
          ),
        );
        assert.ok(evidence.some((x) => x.event === "sigterm"));
        assert.equal(closeFiber.pollUnsafe(), undefined,
          "scope close must still be sleeping after SIGTERM and actual child exit");
        yield* TestClock.adjust(Duration.millis(999));
        assert.equal(closeFiber.pollUnsafe(), undefined,
          "the one-second termination grace has not elapsed");
        yield* TestClock.adjust(Duration.millis(1));
        yield* Fiber.join(closeFiber);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  20_000);

  it.live("closes a real-clock scope, the transport, stdin, launcher, and dist/die", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const { scope } = yield* open(f.events, f.root);
        const started = Date.now();
        yield* closed(scope);
        const elapsedMs = Date.now() - started;
        const evidence = yield* Effect.promise(() =>
          waitFor(f.events, (xs) => xs.some((x) => x.event === "launcher-exit")),
        );
        console.error("[clock] real-scope-close-ms=" + elapsedMs);
        assert.ok(elapsedMs >= 850, "real clock must pay the one-second grace");
        assert.ok(elapsedMs < 8_000);
        assert.ok(evidence.some((x) => x.event === "sigterm"));
        assert.ok(evidence.some((x) => x.event === "die-exit"));
        assert.ok(evidence.some((x) => x.event === "launcher-exit"));
        assert.ok(evidence.some((x) => x.event === "stdin-close-requested"));
        const dieStarted = evidence.find((x) => x.event === "die-start");
        assert.ok(dieStarted?.childPid !== undefined && dieStarted.childPid !== dieStarted.pid);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  20_000);
});
