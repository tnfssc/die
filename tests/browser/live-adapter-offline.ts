/** Opt-in: DIE_CHROMIUM=/path/to/chrome DIE_PLAYWRIGHT_CORE=/path/to/playwright-core bun tests/browser/live-adapter-offline.ts */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";

const chrome = process.env.DIE_CHROMIUM;
const playwrightPath = process.env.DIE_PLAYWRIGHT_CORE;
if (!chrome || !playwrightPath) throw new Error("Set DIE_CHROMIUM and DIE_PLAYWRIGHT_CORE for this opt-in offline browser test");
const { chromium } = await import(pathToFileURL(resolve(playwrightPath, "index.mjs")).href);
const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, "live-adapter-fixture.ts")], target: "browser", format: "esm" });
assert(built.success, JSON.stringify(built.logs));
const bundle = await built.outputs[0]!.text();
let upBytes = 0, upFrames = 0, downBytes = 0;
let serverSocketClosed = false;
const server = Bun.serve<{ sent: boolean }>({
  hostname: "127.0.0.1", port: 0,
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/pending") {
      return new Promise<Response | undefined>(resolve => setTimeout(() => {
        if (server.upgrade(request, { data: { sent: false } })) resolve(undefined);
        else resolve(new Response("aborted", { status: 400 }));
      }, 300));
    }
    if (url.pathname === "/relay") {
      if (server.upgrade(request, { data: { sent: false } })) return;
      return new Response("upgrade failed", { status: 400 });
    }
    if (url.pathname === "/fixture.js") return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    return new Response('<!doctype html><button id="start">Start adapter proof</button><script type="module" src="/fixture.js"></script>', { headers: { "content-type": "text/html" } });
  },
  websocket: {
    message(socket, data) {
      if (typeof data !== "string") { upBytes += data.byteLength; upFrames++; }
      if (!socket.data.sent) {
        socket.data.sent = true;
        socket.send(JSON.stringify({ type: "ready" }));
        const audio = new Uint8Array(9600); // 200ms at 24kHz, PCM16LE
        socket.send(audio); downBytes += audio.byteLength;
        socket.send(JSON.stringify({ type: "interrupted", epoch: 1 }));
      }
    },
    close() { serverSocketClosed = true; },
  },
});
let browser;
try {
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + server.port + '/');
  assert.equal(await page.locator("#start").isEnabled(), true);
  await page.waitForFunction(() => !!(window as any).adapterProof);
  assert.equal(await page.evaluate(() => (window as any).adapterProof.phase), "idle");
  await page.locator("#start").click(); // deliberate start: never auto-request mic
  await page.waitForFunction(() => ["done", "error"].includes((window as any).adapterProof?.phase), undefined, { timeout: 15000 });
  const state = await page.evaluate(() => (window as any).adapterProof);
  await new Promise(resolve => setTimeout(resolve, 80)); // WebSocket closing handshake to server
  console.log(JSON.stringify({ browser: state, relay: { upFrames, upBytes, downBytes, serverSocketClosed } }, null, 2));
  assert.equal(state.phase, "done", state.error);
  assert(state.contextSampleRate >= 16000);
  assert(state.frames > 0 && state.frames <= 50 && state.bytes === state.frames * 640);
  assert(upFrames > 0 && upBytes === upFrames * 640);
  assert.equal(state.receivedAudioBytes, downBytes);
  assert.deepEqual(state.messages.slice(0, 3), ["ready", "audio", "interrupted"]);
  assert(state.queueBeforeClear > 0 && state.queueAfterClear === 0);
  assert(state.pendingSocketAborted && state.captureTracksEnded && state.lateTracksEnded && state.captureClosed && state.outputClosed && serverSocketClosed);
} finally { await browser?.close(); server.stop(true); }
