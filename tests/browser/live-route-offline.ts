#!/usr/bin/env bun
/** Real canonical UI + route browser gate. Requires an isolated server with a fake FD3/FD4
 * owning Pi peer (no credentials, paid network, or physical mic). See wisdom/live/web-route-browser-acceptance.md.
 */
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { instrumentVoicePage, assertTeardown } from "./live-route-probe";

const { DIE_LIVE_BROWSER_URL: url, DIE_LIVE_BROWSER_WS_PATH: route,
  DIE_LIVE_BROWSER_FAKE_IPC_EVIDENCE: evidencePath, DIE_LIVE_BROWSER_MISSING_URL: missingUrl,
  DIE_CHROMIUM: chrome, DIE_PLAYWRIGHT_CORE: playwrightPath } = process.env;
if (!url || !route || !evidencePath || !missingUrl || !chrome || !playwrightPath)
  throw new Error("Set DIE_LIVE_BROWSER_URL, DIE_LIVE_BROWSER_WS_PATH, DIE_LIVE_BROWSER_FAKE_IPC_EVIDENCE, DIE_LIVE_BROWSER_MISSING_URL, DIE_CHROMIUM and DIE_PLAYWRIGHT_CORE. The URL MUST serve the shipped canonical UI/route with a fake Pi IPC peer.");
const target = new URL(url);
assert(["127.0.0.1", "localhost"].includes(target.hostname), "fake acceptance server must be loopback");
assert.equal(route, "/api/voice/ws", "refusing adapter-only or custom WebSocket endpoint");
const { chromium } = await import(pathToFileURL(resolve(playwrightPath, "index.mjs")).href);
const browser = await chromium.launch({ executablePath: chrome, headless: true,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const results: unknown[] = [];
try {
  for (const provider of ["Gemini", "OpenAI"]) {
    const page = await browser.newPage();
    try {
      // Reject browser requests to paid provider endpoints. Server fake IPC evidence
      // independently proves no real provider call occurred in the owning process.
      await page.route("**/*", (request: any) => {
        const dest = new URL(request.request().url());
        return dest.origin === target.origin ? request.continue() : request.abort();
      });
      const proof = await instrumentVoicePage(page, route);
      await page.goto(url);
      const providerControl = page.getByRole("combobox", { name: "Voice provider" });
      await providerControl.waitFor({ timeout: 15000 });
      assert.equal(proof.mediaRequests, 0, "microphone requested before explicit action");
      assert.equal(proof.socketOpens, 0, "voice socket opened before explicit action");
      await providerControl.selectOption({ label: provider });
      await page.getByRole("button", { name: "Start voice" }).click();
      await page.getByRole("status").filter({ hasText: "Voice connected" }).waitFor({ timeout: 20000 });
      const pcmDeadline = Date.now() + 5000;
      while (!proof.uploadPayloadBytes && Date.now() < pcmDeadline) await Bun.sleep(50);
      assert(proof.uploadPayloadBytes > 0, "fake mic yielded no PCM on canonical route");
      await page.getByRole("button", { name: "Mute", exact: true }).click();
      await page.getByRole("button", { name: "Unmute", exact: true }).waitFor();
      await page.getByRole("button", { name: "Unmute", exact: true }).click();
      await page.getByRole("button", { name: "Mute", exact: true }).waitFor();
      // In-session provider switch must revoke old owner and tear down capture.
      const nextProvider = provider === "Gemini" ? "OpenAI" : "Gemini";
      await providerControl.selectOption({ label: nextProvider });
      await page.getByRole("button", { name: "Start voice" }).waitFor();
      const endAt = Date.now() + 5000;
      while (proof.socketCloses !== proof.socketOpens && Date.now() < endAt) await Bun.sleep(50);
      assertTeardown(proof);
      const before = proof.mediaRequests;
      await page.getByRole("button", { name: "Start voice" }).click();
      await page.getByRole("status").filter({ hasText: "Voice connected" }).waitFor({ timeout: 20000 });
      assert(proof.mediaRequests > before, "provider switch did not require a new explicit action");
      // Switching the selected thread unmounts the live controller; no old Pi owner survives.
      await page.evaluate(() => { (window as any).__dieShowThread("thread-b"); });
      await page.getByRole("button", { name: "Start voice" }).waitFor();
      const switchDeadline = Date.now() + 5000;
      while (proof.socketCloses !== proof.socketOpens && Date.now() < switchDeadline) await Bun.sleep(50);
      assertTeardown(proof);
      await page.evaluate(() => { (window as any).__dieShowThread("thread-a"); });
      await page.getByRole("button", { name: "Start voice" }).click();
      await page.getByRole("status").filter({ hasText: "Voice connected" }).waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: "End voice" }).click();
      await page.getByRole("button", { name: "Start voice" }).waitFor();
      const deadline = Date.now() + 5000;
      while (proof.socketCloses !== proof.socketOpens && Date.now() < deadline) await Bun.sleep(50);
      assertTeardown(proof);
      assert(proof.uploadPayloadBytes > 0, "fake microphone did not produce PCM uplink");
      assert(proof.downloadFrames >= 3 && proof.downloadPayloadBytes >= 2880, "owning Pi raw PCM downlink missing");
      results.push({ provider, proof });
    } finally { await page.close(); }
  }
  // Separate isolated canonical server instance configured with no credentials.
  const missing = new URL(missingUrl);
  assert(["127.0.0.1", "localhost"].includes(missing.hostname));
  const missingPage = await browser.newPage();
  try {
    const missingProof = await instrumentVoicePage(missingPage, route);
    await missingPage.goto(missingUrl);
    await missingPage.getByRole("combobox", { name: "Voice provider" }).selectOption({ label: "Gemini" });
    assert.equal(missingProof.mediaRequests, 0, "missing-key page requested mic before action");
    await missingPage.getByRole("button", { name: "Start voice" }).click();
    await missingPage.getByRole("status").filter({ hasText: /credentials|key|sign.in|configure/i }).waitFor({ timeout: 15000 });
    const deadline = Date.now() + 5000;
    while (missingProof.socketCloses !== missingProof.socketOpens && Date.now() < deadline) await Bun.sleep(50);
    assert(missingProof.socketOpens > 0 && missingProof.socketCloses === missingProof.socketOpens,
      "missing credentials kept route socket open");
    assert.equal(missingProof.tracksStopped, missingProof.mediaTracks, "missing credentials left microphone running");
    results.push({ missingCredentialsVisible: true, socketCloses: missingProof.socketCloses, tracksStopped: missingProof.tracksStopped });
  } finally { await missingPage.close(); }
  // Real HTTP requests hit the same Effect NodeHttpServer route, not toWebHandler mocks.
  for (const [path, headers, expected] of [
    ["?threadId=thread-a", {}, 403],
    ["?threadId=thread-a", { origin: "https://evil.example" }, 403],
    ["?threadId=thread-a", { origin: target.origin, "x-die-fixture-unauthorized": "1" }, 401],
    ["?threadId=thread-a", { origin: target.origin, "x-die-fixture-read-only": "1" }, 401],
    ["?threadId=../bad", { origin: target.origin }, 400],
    ["?threadId=stale-thread", { origin: target.origin }, 409],
  ] as const) {
    const response = await fetch(target.origin + route + path, { headers });
    assert.equal(response.status, expected, "network auth/origin/stale owner rejection: " + path);
    await response.body?.cancel();
  }
  const evidence = JSON.parse(await Bun.file(evidencePath).text());
  assert.deepEqual(evidence.providers?.sort(), ["gemini", "openai"], "fake IPC peer did not observe both providers");
  assert.equal(evidence.paidCalls, 0, "a paid provider call was made");
  assert(evidence.uploadBytes > 0, "actual owning Pi FD3 did not receive microphone PCM");
  assert(evidence.stops >= 6, "owner did not ACK all provider/thread/end teardown events");
  console.log(JSON.stringify({ gate: "canonical-ui-and-route", results, fakeIpc: evidence }, null, 2));
} finally { await browser.close(); }
