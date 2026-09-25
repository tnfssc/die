#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = resolve(repositoryRoot, ".cache/die-t3code-v0042");
const expectedHead = "719a76ca1dbf5490f1aa33ffb9966301e02be9a9";
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (head !== expectedHead) throw new Error("probe belongs to " + expectedHead + ", found " + head);
if (JSON.parse(readFileSync(resolve(repositoryRoot, "web/t3-source.json"), "utf8")).revision !== head)
  throw new Error("pin mismatch");
execFileSync("git", ["apply", "--reverse", "--check", resolve(repositoryRoot, "web/t3.patch")], { cwd: root });
const load = (path) => readFileSync(resolve(root, path), "utf8");
const line = (text, needle) => {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error("missing source marker: " + needle);
  return text.slice(0, index).split("\n").length;
};
const requireSource = (condition, detail) => {
  if (!condition) throw new Error(detail);
};

const recordingPath = "apps/web/src/browser/browserRecording.ts";
const recording = load(recordingPath);
const prepareStart = recording.indexOf("const prepareTabMediaCapture");
const prepareEnd = recording.indexOf("const triggerTabMediaCapture", prepareStart);
const timeoutStart = recording.indexOf("const captureTabMediaStreamWithTimeout");
const timeoutEnd = recording.indexOf("const clearActiveRecording", timeoutStart);
const failedStart = recording.indexOf("const cleanupFailedRecordingStart");
const failedEnd = recording.indexOf("const recordingStartupCancelledError", failedStart);
const prepare = recording.slice(prepareStart, prepareEnd);
const timeout = recording.slice(timeoutStart, timeoutEnd);
const failed = recording.slice(failedStart, failedEnd);
requireSource(
  prepare.includes("pendingTabMediaCaptures.set(tabId, pending)"),
  "pending capture is no longer registered",
);
requireSource(
  prepare.includes("pendingTabMediaCaptures.delete(tabId)"),
  "capture cancellation no longer clears registration",
);
requireSource(
  !timeout.includes("pendingTabMediaCaptures.delete") && !timeout.includes("capture.cancel"),
  "timeout now clears pending capture; refresh audit",
);
requireSource(
  !failed.includes("pendingTabMediaCaptures.delete") && !failed.includes("capture.cancel"),
  "failed-start cleanup now clears pending capture; refresh audit",
);

const syntaxPath = "apps/web/src/lib/syntaxHighlighting.ts";
const syntax = load(syntaxPath);
requireSource(syntax.includes("const highlighterPromiseCache = new Map"), "syntax cache changed");
requireSource(syntax.includes("highlighterPromiseCache.set(language, promise)"), "syntax cache insertion changed");
requireSource(
  (syntax.match(/highlighterPromiseCache\.delete/g) ?? []).length === 1,
  "syntax cache deletion policy changed",
);
const handoffPath = "apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx";
const handoff = load(handoffPath);
requireSource(handoff.includes("lastHandoffPromptByDraft.set(key, task.prompt)"), "handoff cache insertion changed");
requireSource(
  !handoff.includes("lastHandoffPromptByDraft.delete") && !handoff.includes("lastHandoffPromptByDraft.clear"),
  "handoff cache is now pruned; refresh audit",
);

const rpcPath = "packages/client-runtime/src/rpc/session.ts";
const rpc = load(rpcPath);
requireSource(
  rpc.includes("PubSub.sliding<BufferedServerConfigEvent>(64)"),
  "RPC config PubSub is no longer bounded at 64",
);
requireSource(rpc.includes("Effect.forkScoped"), "RPC config stream is no longer scope-owned");
const faviconPath = "packages/client-runtime/src/projectFaviconCache.ts";
const favicon = load(faviconPath);
requireSource(favicon.includes("entries.size > PROJECT_FAVICON_CACHE_MAX_ENTRIES"), "favicon entry bound changed");
requireSource(favicon.includes("bytes > PROJECT_FAVICON_CACHE_MAX_BYTES"), "favicon byte bound changed");
const at = (path, text, needle) => path + ":" + line(text, needle);
console.log(
  JSON.stringify(
    {
      head,
      classification: "source-only structural probe",
      retainedGrowth: {
        pendingDesktopCapture: {
          registration: at(recordingPath, recording, "pendingTabMediaCaptures.set(tabId, pending)"),
          timeoutFinally: at(recordingPath, recording, "acceptStream = false;\n    if (timeoutId !== null)"),
          failedStartCleanup: at(recordingPath, recording, "const cleanupFailedRecordingStart"),
        },
        syntaxLanguageCache: at(syntaxPath, syntax, "const highlighterPromiseCache"),
        pullRequestPromptCache: at(handoffPath, handoff, "const lastHandoffPromptByDraft"),
      },
      boundedLifecycleControls: {
        rpcPubSub: at(rpcPath, rpc, "PubSub.sliding<BufferedServerConfigEvent>(64)"),
        rpcForkScoped: at(rpcPath, rpc, "Effect.forkScoped"),
        projectFaviconTrim: at(faviconPath, favicon, "const trim = () =>"),
      },
    },
    null,
    2,
  ),
);
