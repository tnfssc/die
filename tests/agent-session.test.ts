import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareAgentSession } from "../src/tasks/agent-session";
import { SessionManager } from "@earendil-works/pi-coding-agent";
test("agent sessions are durable before any model response, linked and clearly named", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-agent-session-"));
  try {
    for (const type of ["fast", "orchestrator"]) {
      const prepared = await prepareAgentSession(process.cwd(), dir, {
        type,
        model: "p/model",
        depth: 1,
        parentSessionFile: "/parent.jsonl",
      });
      const saved = SessionManager.open(prepared.agent.sessionFile);
      expect(saved.getHeader()?.parentSession).toBe("/parent.jsonl");
      expect(saved.getSessionName()).toContain(type === "orchestrator" ? "[orchestrator agent]" : "[subagent · fast]");
      expect(saved.getEntries().find((e) => e.type === "custom" && e.customType === "die-agent")).toMatchObject({
        data: { taskId: prepared.id, type, model: "p/model", depth: 1 },
      });
      expect((await readFile(prepared.agent.sessionFile, "utf8")).trim().split("\n")).toHaveLength(3);
    }
    expect(await SessionManager.list(process.cwd(), dir)).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
