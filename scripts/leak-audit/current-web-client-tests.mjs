#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = resolve(repositoryRoot, ".cache/die-t3code-v0042");
const vp = resolve(root, "node_modules/.bin/vp");
const run = (cwd, args, executable = vp) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd, stdio: "inherit", env: process.env });
    console.error("owned child pid=" + child.pid + " cwd=" + cwd);
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolveRun()
        : reject(new Error("child " + child.pid + " failed: code=" + code + " signal=" + signal)),
    );
  });

await run(repositoryRoot, ["scripts/leak-audit/current-web-client-source-probe.mjs"], process.execPath);

const browserTest = resolve(root, "apps/web/src/browser/browserRecording.test.ts");
const generatedTest = resolve(root, "apps/web/src/browser/leak-audit-current-web-client-probe.test.ts");
const original = await readFile(browserTest, "utf8");
const marker = "\n});\n";
const close = original.lastIndexOf(marker);
if (close < 0) throw new Error("cannot locate browser recording describe closure");
const probe = [
  "",
  '  it("leak audit: retains a pending capture when native start never invokes its trigger", async () => {',
  "    vi.useFakeTimers();",
  "    requestDisplayMediaCapture.mockImplementationOnce(() => undefined);",
  '    const tabId = "leak-audit-missing-native-trigger";',
  "    const startPromise = startBrowserRecording(tabId);",
  "    const rejection = expect(startPromise).rejects.toBeInstanceOf(BrowserRecordingCaptureTimeoutError);",
  "    await vi.waitFor(() => expect(startScreencast).toHaveBeenCalledWith(tabId));",
  "    await vi.advanceTimersByTimeAsync(BROWSER_RECORDING_STARTUP_SETTLE_TIMEOUT_MS);",
  "    await rejection;",
  "",
  "    const trigger = Reflect.get(globalThis, DESKTOP_PREVIEW_RECORDING_CAPTURE_TRIGGER);",
  '    expect(typeof trigger).toBe("function");',
  "    // False would mean timeout cleanup removed the registration. Current true proves retention.",
  "    expect(trigger(tabId)).toBe(true);",
  "    await vi.advanceTimersByTimeAsync(0);",
  "  });",
].join("\n");
await writeFile(generatedTest, original.slice(0, close) + probe + original.slice(close), { flag: "wx" });
try {
  await run(resolve(root, "apps/web"), [
    "test",
    "run",
    "--project",
    "unit",
    "src/browser/leak-audit-current-web-client-probe.test.ts",
    "src/components/device/deviceStream.test.ts",
    "src/hooks/useLiveRefresh.test.ts",
    "src/lib/attachmentUploadQueue.test.ts",
    "src/lib/backgroundActivityReporter.test.ts",
    "src/lib/syntaxHighlighting.test.ts",
    "src/rpc/requestLatencyState.test.ts",
    "src/state/terminalSessions.test.ts",
    "src/terminal/ghostty/surface.test.ts",
  ]);
  await run(resolve(root, "packages/client-runtime"), [
    "test",
    "run",
    "src/rpc/session.test.ts",
    "src/connection/registry.test.ts",
    "src/connection/resolver.test.ts",
    "src/projectFaviconCache.test.ts",
    "src/relay/discovery.test.ts",
  ]);
} finally {
  await rm(generatedTest, { force: true });
}
