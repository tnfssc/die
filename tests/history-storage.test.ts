import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const scenario = String.raw`
const { existsSync, readFileSync } = await import("node:fs");
const { join } = await import("node:path");
if (process.env.USE_DISK_HISTORY === "1") {
  const { installDiskBackedSessionManager } = await import("./src/history/session-manager.ts");
  installDiskBackedSessionManager();
}
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const root = process.env.SCENARIO_ROOT;
const sessions = join(root, "sessions");
const user = (content) => ({ role: "user", content, timestamp: 1 });
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "test", model: "test", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
const manager = SessionManager.create(root, sessions, { id: "01234567-89ab-4def-8123-456789abcdef" });
const file = manager.getSessionFile();
const before = existsSync(file);
const first = manager.appendMessage(user("first user"));
const afterUser = existsSync(file);
const answer = manager.appendMessage(assistant("first assistant"));
const afterAssistant = existsSync(file);
const flushedTypes = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line).type);
const resumed = SessionManager.continueRecent(root, sessions);
const resumedState = { count: resumed.getEntries().length, leafIsAnswer: resumed.getLeafId() === answer, fileMatches: resumed.getSessionFile() === file };
let reopened = SessionManager.open(file, sessions);
const tail = reopened.appendMessage(user("tail"));
reopened.branch(answer);
const branch = reopened.appendMessage(user("branch"));
const branchAnswer = reopened.appendMessage(assistant("branch assistant"));
reopened.resetLeaf();
const reset = reopened.appendMessage(user("new root"));
const entries = reopened.getEntries();
const parent = (id) => entries.find((entry) => entry.id === id)?.parentId;
const branchedFile = reopened.createBranchedSession(branchAnswer);
const branchCopy = SessionManager.open(branchedFile, sessions).getEntries();
const forked = SessionManager.forkFrom(file, join(root, "fork-cwd"), join(root, "fork-sessions"), { id: "fedcba98-7654-4321-8123-456789abcdef" });
const forkEntries = forked.getEntries();
const oldFile = reopened.getSessionFile();
const freshFile = reopened.newSession({ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
const newEmpty = reopened.getEntries().length;
reopened.appendMessage(user("fresh user"));
const freshAbsentBeforeAssistant = !existsSync(freshFile);
reopened.appendMessage(assistant("fresh assistant"));
const result = {
  before, afterUser, afterAssistant, flushedTypes, resumed: resumedState,
  reopened: { count: entries.length, tailParent: parent(tail) === answer, branchParent: parent(branch) === answer, resetParent: parent(reset) },
  branchCopy: { types: branchCopy.map((entry) => entry.type), contents: branchCopy.filter((entry) => entry.type === "message").map((entry) => entry.message.content) },
  fork: { parentSession: forked.getHeader().parentSession === file, count: forkEntries.length, contents: forkEntries.filter((entry) => entry.type === "message").map((entry) => entry.message.content) },
  newSession: { changed: freshFile !== oldFile, empty: newEmpty, absentBeforeAssistant: freshAbsentBeforeAssistant, persisted: existsSync(freshFile) },
};
console.log(JSON.stringify(result));
`;

async function runScenario(root: string, adapted: boolean) {
  const child = Bun.spawn([process.execPath, "-e", scenario], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, SCENARIO_ROOT: root, USE_DISK_HISTORY: adapted ? "1" : "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`scenario failed (${exitCode}): ${stderr}`);
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
}

describe("disk-backed SessionManager SDK compatibility", () => {
  test("matches an unpatched subprocess for flush, reopen, branch, reset, fork, and newSession", async () => {
    const nativeRoot = await mkdtemp(join(tmpdir(), "die-history-native-"));
    const adaptedRoot = await mkdtemp(join(tmpdir(), "die-history-adapted-"));
    roots.push(nativeRoot, adaptedRoot);
    const [native, adapted] = await Promise.all([runScenario(nativeRoot, false), runScenario(adaptedRoot, true)]);
    expect(adapted).toEqual(native);
    expect(adapted.before).toBe(false);
    expect(adapted.afterUser).toBe(false);
    expect(adapted.afterAssistant).toBe(true);
    expect(adapted.flushedTypes).toEqual(["session", "message", "message"]);
    expect(adapted.resumed).toEqual({ count: 2, leafIsAnswer: true, fileMatches: true });
    expect(adapted.reopened.tailParent).toBe(true);
    expect(adapted.reopened.branchParent).toBe(true);
    expect(adapted.reopened.resetParent).toBeNull();
    expect(adapted.branchCopy.types).toEqual(["message", "message", "message", "message"]);
    expect(JSON.stringify(adapted.branchCopy.contents)).toContain("branch assistant");
    expect(adapted.fork.count).toBe(6);
    expect(adapted.newSession).toEqual({ changed: true, empty: 0, absentBeforeAssistant: true, persisted: true });
  }, 30_000);

  test("keeps compacted originals and stable references across reopen while context stays compact", async () => {
    const root = await mkdtemp(join(tmpdir(), "die-history-compaction-"));
    roots.push(root);
    const compactScenario = `
const { join } = await import("node:path");
const { statSync } = await import("node:fs");
const { installDiskBackedSessionManager } = await import("./src/history/session-manager.ts");
installDiskBackedSessionManager();
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const root = process.env.SCENARIO_ROOT;
const sessions = join(root, "sessions");
let manager = SessionManager.create(root, sessions);
const original = "ORIGINAL-EVIDENCE:" + "x".repeat(512 * 1024);
const originalId = manager.appendMessage({ role: "user", content: original, timestamp: 1 });
manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "old answer" }], api: "openai-responses", provider: "test", model: "test", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
const keptId = manager.appendMessage({ role: "user", content: "kept tail", timestamp: 3 });
const compactionId = manager.appendCompaction("tiny summary", keptId, 100000, { strategy: "cache-affine-plaintext", rewritten: true });
manager.appendMessage({ role: "user", content: "after compaction", timestamp: 4 });
const file = manager.getSessionFile();
manager = SessionManager.open(file, sessions);
const originalEntry = manager.getEntry(originalId);
const compaction = manager.getEntry(compactionId);
const contextText = JSON.stringify(manager.buildSessionContext().messages);
console.log(JSON.stringify({ originalSurvived: originalEntry.message.content === original, referenceSurvived: compaction.firstKeptEntryId === keptId, rewrittenDetailsSurvived: compaction.details?.strategy === "cache-affine-plaintext" && compaction.details?.rewritten === true, summary: contextText.includes("tiny summary"), kept: contextText.includes("kept tail"), after: contextText.includes("after compaction"), omittedOriginal: !contextText.includes("ORIGINAL-EVIDENCE"), fileSize: statSync(file).size, originalLength: original.length }));
`;
    const child = Bun.spawn([process.execPath, "-e", compactScenario], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, SCENARIO_ROOT: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`compaction scenario failed (${exitCode}): ${stderr}`);
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result).toMatchObject({
      originalSurvived: true,
      referenceSurvived: true,
      rewrittenDetailsSurvived: true,
      summary: true,
      kept: true,
      after: true,
      omittedOriginal: true,
    });
    expect(result.fileSize).toBeGreaterThan(result.originalLength);
  }, 30_000);
});
