/** Real bridge over owned in-memory streams; no child processes or session files. */
import { PassThrough, Duplex } from "node:stream";
import { getEventListeners } from "node:events";
import { installJobGlobals, serveJobBridge } from "../../src/typescript/job-bridge";
import { withJobCancellation } from "../../src/job-delivery";
const a = new PassThrough(),
  b = new PassThrough();
// Bun types omit Node's supported Node-stream pair overload.
const fromPair = Duplex.from as unknown as (pair: { readable: PassThrough; writable: PassThrough }) => Duplex;
const worker = fromPair({ readable: b, writable: a });
const parent = fromPair({ readable: a, writable: b });
const handoff = new AbortController();
const server = serveJobBridge(
  parent,
  async (_method, _params, signal) => {
    withJobCancellation(signal, handoff.signal);
    return {};
  },
  new AbortController().signal,
  {},
);
const globals = installJobGlobals(worker);
async function sample(label: string) {
  for (let i = 0; i < 3; i++) {
    await Bun.sleep(30);
    Bun.gc(true);
  }
  console.log(
    JSON.stringify({
      label,
      listeners: getEventListeners(handoff.signal, "abort").length,
      heapMiB: process.memoryUsage().heapUsed / 1048576,
    }),
  );
}
try {
  await sample("baseline");
  for (let batch = 1; batch <= 10; batch++) {
    for (let i = 0; i < 1000; i++) await (globalThis as any).jobs.list();
    if (batch % 2 === 0) await sample("acknowledged " + batch * 1000);
  }
  server.close(true);
  await sample("bridge closed");
} finally {
  server.close();
  await globals.finish();
}
