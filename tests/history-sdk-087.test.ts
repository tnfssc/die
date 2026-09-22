import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const scenario = String.raw`
import { SessionManager } from "@earendil-works/pi-coding-agent";
if (process.env.USE_DISK_HISTORY === "1") {
  const { installDiskBackedSessionManager } = await import("./src/history/session-manager.ts");
  installDiskBackedSessionManager();
}
const root = process.env.SCENARIO_ROOT;
const manager = SessionManager.create(root, root);
const system = manager.appendMessage({ role: "system", content: "system-v1", timestamp: 1 });
const user = manager.appendMessage({ role: "user", content: "original user", timestamp: 2 });
const assistant = manager.appendMessage({
  role: "assistant",
  content: [{ type: "text", text: "original assistant" }],
  api: "openai-responses",
  provider: "fixture",
  model: "fixture-model",
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: 3,
});
manager.appendContextEdit(user, { content: "edited user" });
manager.appendContextEdit(assistant, { content: "edited assistant" });
const edited = manager.buildSessionProjection();
const compact = manager.appendCompaction("compact summary", null, 123);
manager.appendMessage({ role: "user", content: "after compact", timestamp: 4 });
const compacted = manager.buildSessionProjection();
const simplifyMessage = (message) => ({ role: message.role, content: message.content });
const simplify = (projection) => ({
  entries: projection.entries.map(({ sourceEntry, messages }) => ({
    type: sourceEntry.type,
    messages: messages.map(simplifyMessage),
  })),
  messages: projection.messages.map(simplifyMessage),
  thinkingLevel: projection.thinkingLevel,
  model: projection.model,
});
const compaction = manager.getEntry(compact);
const extended = SessionManager.create(root, root);
const base = extended.appendMessage({ role: "system", content: "base", timestamp: 10 });
const keep = extended.appendMessage({ role: "user", content: "keep me", timestamp: 11 });
const answer = extended.appendMessage({ ...manager.getEntry(assistant).message, timestamp: 12 });
const custom = extended.appendCustomMessageEntry("fixture", "custom original", true);
const tool = extended.appendMessage({ role: "toolResult", toolCallId: "t", toolName: "fixture", content: [{type: "text", text: "tool original"}], isError: false, timestamp: 13 });
extended.appendContextEdit(custom, {content: "custom replacement"});
extended.appendContextEdit(tool, {content: "tool replacement"});
const editLeaf = extended.appendContextEdit(answer, null);
const replacements = simplify(extended.buildSessionProjection());
const reopened = SessionManager.open(extended.getSessionFile());
const reopenedProjection = simplify(reopened.buildSessionProjection());
const originalsIntact = reopened.getEntry(custom).content === "custom original" && reopened.getEntry(tool).message.content[0].text === "tool original";
const rejects = [];
for (const target of [base, "missing-id"]) {
  try { extended.appendContextEdit(target, null); rejects.push(false); } catch { rejects.push(true); }
}
extended.branch(tool);
try { extended.appendContextEdit(editLeaf, null); rejects.push(false); } catch { rejects.push(true); }
const branchWithoutEdits = simplify(extended.buildSessionProjection());
const firstCompact = extended.appendCompaction("first checkpoint", keep, 50);
extended.appendMessage({role: "system", content: "delta", timestamp: 14});
extended.appendThinkingLevelChange("high");
extended.appendModelChange("fixture", "updated-model");
extended.appendCompaction("second checkpoint", firstCompact, 25);
const repeatedCompaction = simplify(extended.buildSessionProjection());
console.log(JSON.stringify({
  replacements, reopenedProjection, originalsIntact, rejects, branchWithoutEdits, repeatedCompaction,
  edited: simplify(edited),
  compacted: simplify(compacted),
  context: manager.buildSessionContext().messages.map(simplifyMessage),
  compaction: {
    selfKept: compaction.firstKeptEntryId === compact,
    systemContent: compaction.systemMessage?.content,
  },
  idsPresent: [system, user, assistant].every((id) => manager.getEntry(id)),
}));
`;

async function run(root: string, adapted: boolean) {
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

describe("Pi 0.87 disk-backed session projection compatibility", () => {
  test("matches the real SDK for context edits and compaction system checkpoints", async () => {
    const nativeRoot = await mkdtemp(join(tmpdir(), "die-history-087-native-"));
    const adaptedRoot = await mkdtemp(join(tmpdir(), "die-history-087-adapted-"));
    roots.push(nativeRoot, adaptedRoot);
    const [native, adapted] = await Promise.all([run(nativeRoot, false), run(adaptedRoot, true)]);

    expect(adapted).toEqual(native);
    expect(adapted.edited.messages.map((message: { content: unknown }) => message.content)).toContain("edited user");
    expect(JSON.stringify(adapted.edited.messages)).toContain("edited assistant");
    expect(adapted.compaction).toEqual({ selfKept: true, systemContent: "system-v1" });
    expect(adapted.compacted.messages[0]).toEqual({ role: "system", content: "system-v1" });
    expect(JSON.stringify(adapted.compacted.messages)).not.toContain("original user");
    expect(adapted.context).toEqual(adapted.compacted.messages);
    expect(adapted.idsPresent).toBe(true);
    expect(adapted.reopenedProjection).toEqual(adapted.replacements);
    expect(adapted.originalsIntact).toBe(true);
    expect(adapted.rejects).toEqual([true, true, true]);
    expect(JSON.stringify(adapted.replacements.messages)).toContain("custom replacement");
    expect(JSON.stringify(adapted.replacements.messages)).toContain("tool replacement");
    expect(adapted.replacements.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
    expect(JSON.stringify(adapted.branchWithoutEdits.messages)).toContain("custom original");
    expect(JSON.stringify(adapted.branchWithoutEdits.messages)).not.toContain("replacement");
    expect(adapted.repeatedCompaction.thinkingLevel).toBe("high");
    expect(adapted.repeatedCompaction.model).toEqual({ provider: "fixture", modelId: "updated-model" });
    expect(JSON.stringify(adapted.repeatedCompaction.messages)).not.toContain("first checkpoint");
  }, 30_000);
});
