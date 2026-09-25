/** Actual upstream Effect Node HTTP route + real FD3/FD4 fake owning Pi + actual Bun-built VoiceControls. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const source = resolve(process.env.DIE_T3_SOURCE ?? "");
if (!process.env.DIE_T3_SOURCE) throw new Error("DIE_T3_SOURCE must point to canonical upstream checkout");
const server = join(source, "apps/server");
const req = createRequire(join(server, "package.json"));
const dep = async (name: string) => import(pathToFileURL(req.resolve(name)).href);
const [
  Effect,
  Layer,
  NodeHttpServer,
  NodeServices,
  Router,
  Response,
  Auth,
  Contracts,
  Channels,
  Route,
  ThreadManagement,
  ChildProcess,
  Spawner,
] = await Promise.all([
  dep("effect/Effect"),
  dep("effect/Layer"),
  dep("@effect/platform-node/NodeHttpServer"),
  dep("@effect/platform-node/NodeServices"),
  dep("effect/unstable/http/HttpRouter"),
  dep("effect/unstable/http/HttpServerResponse"),
  import(pathToFileURL(join(server, "src/auth/EnvironmentAuth.ts")).href),
  import(pathToFileURL(join(source, "packages/contracts/src/index.ts")).href),
  import(pathToFileURL(join(server, "src/voice/PiVoiceChannels.ts")).href),
  import(pathToFileURL(join(server, "src/voice/VoiceRoute.ts")).href),
  import(pathToFileURL(join(server, "src/orchestration-v2/ThreadManagementService.ts")).href),
  dep("effect/unstable/process/ChildProcess"),
  dep("effect/unstable/process/ChildProcessSpawner"),
]);
const temp = await mkdtemp(join(tmpdir(), "die-voice-route-"));
const entry = join(source, "apps/web/src", ".die-voice-fixture-" + process.pid + ".tsx");
await writeFile(
  entry,
  `import React from "react"; import { createRoot } from "react-dom/client"; import { VoiceControls } from "./components/VoiceControls"; let root = createRoot(document.getElementById("root")!); (window as any).__dieShowThread = (threadId: string) => root.render(<VoiceControls threadId={threadId} />); (window as any).__dieShowThread(location.pathname.slice(1) || "thread-a");`,
);

let bundle: string;
try {
  const build = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    minify: false,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!build.success) throw new Error(build.logs.map(String).join("\n"));
  bundle = await build.outputs[0]!.text();
} finally {
  await rm(entry, { force: true });
}
const html =
  '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const fixture = resolve(import.meta.dir, "live-route-fake-pi.ts");
async function freePort() {
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((done) => listener.close(() => done()));
  return port;
}
const ports = [await freePort(), await freePort()];
const paths = [join(temp, "evidence.json"), join(temp, "missing.json")];
const lifetime = new AbortController();
process.once("SIGTERM", () => lifetime.abort());
process.once("SIGINT", () => lifetime.abort());
const roots = ports
  .map((port, index) =>
    Effect.gen(function* () {
      const spawner = yield* Spawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        ChildProcess.make(process.execPath, [fixture], {
          additionalFds: { fd3: { type: "input" }, fd4: { type: "output" } },
          env: {
            ...process.env,
            DIE_FAKE_EVIDENCE: paths[index],
            DIE_WEB_VOICE_FD: "3",
            DIE_WEB_VOICE_OUTPUT_FD: "4",
            ...(index ? { DIE_FAKE_MISSING: "1" } : {}),
          },
        }),
      );
      yield* Channels.attachPiVoiceChannel(child, index ? "missing" : "thread-a", "fixture-session");
      const authLayer = Layer.succeed(Auth.EnvironmentAuth, {
        authenticateWebSocketUpgrade: (request: { headers: Record<string, string> }) =>
          request.headers["x-die-fixture-unauthorized"] === "1"
            ? Effect.fail(new Error("unauthorized fixture"))
            : Effect.succeed({
                sessionId: Contracts.AuthSessionId.make("fixture"),
                subject: "fixture",
                method: "bearer-access-token",
                scopes: [
                  request.headers["x-die-fixture-read-only"] === "1"
                    ? Contracts.AuthOrchestrationReadScope
                    : Contracts.AuthOrchestrationOperateScope,
                ],
              }),
      });
      let detached = false;
      const threadLayer = Layer.succeed(ThreadManagement.ThreadManagementService, {
        getThreadSnapshot: (id: string) =>
          Effect.sync(() => ({
            projection: {
              thread: { id, archivedAt: null, activeProviderThreadId: detached ? null : "provider-thread" },
              providerThreads: [{ id: "provider-thread", providerSessionId: "fixture-session", appThreadId: id }],
            },
          })),
      });
      const staticRoutes = Router.add(
        "GET",
        "/fixture.js",
        Effect.succeed(Response.text(bundle, { headers: { "content-type": "application/javascript" } })),
      ).pipe(Layer.merge(Router.add("GET", "/:threadId", Effect.succeed(Response.html(html)))));
      const detachRoute = Router.add("POST", "/fixture/detach", Effect.sync(() => { detached = true; return Response.empty(); }));
      const observedRoute = Route.voiceRouteLayer;
      const routes = Router.serve(Layer.merge(observedRoute, Layer.merge(staticRoutes, detachRoute)), { disableLogger: true }).pipe(
        Layer.provide(Layer.merge(authLayer, threadLayer)),
      );
      yield* Layer.build(
        routes.pipe(
          Layer.provide(NodeHttpServer.layer(() => createServer(), { host: "127.0.0.1", port })),
          Layer.provide(NodeServices.layer),
        ),
      );
      return yield* Effect.never;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
  .map((effect) => Effect.runPromise(effect, { signal: lifetime.signal }));
const pending = roots.map((task) =>
  task.catch((err: unknown) => {
    if (!lifetime.signal.aborted) {
      console.error(err);
      process.exitCode = 1;
    }
  }),
);
for (let i = 0; i < ports.length; i++) {
  const url = "http://127.0.0.1:" + ports[i] + "/" + (i ? "missing" : "thread-a");
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("server did not start: " + url);
}
console.log(
  JSON.stringify({
    url: "http://127.0.0.1:" + ports[0] + "/thread-a",
    missingUrl: "http://127.0.0.1:" + ports[1] + "/missing",
    evidencePath: paths[0],
  }),
);
try {
  await Promise.all(pending);
} finally {
  await rm(temp, { recursive: true, force: true });
}
