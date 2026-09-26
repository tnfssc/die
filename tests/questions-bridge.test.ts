import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { QuestionService } from "../src/questions/service";
import { executeIsolated } from "../src/typescript/execution";

test("real isolated execute asks without waiting and exposes block/read/resolve, not answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "die-question-bridge-"));
  const service = new QuestionService();
  const ctx = {
    sessionManager: {
      getSessionId: () => "session",
      getSessionFile: () => join(dir, "session.jsonl"),
      getLeafId: () => "root",
      getBranch: () => [{ id: "root" }],
    },
  };
  try {
    const result = await executeIsolated(
      'const q=await questions.ask({text:"Pick target?",choices:["A","B"],dedupKey:"target"}); console.log("independent work still runs"); const b=await questions.block({id:q.id,owner:q.owner,version:q.version,checkpoint:"Need deployment target",foreground:true}); console.log(JSON.stringify(await questions.get(q.id))); console.log(typeof questions.answer); console.log(JSON.stringify(await questions.list())); await questions.resolve({id:b.id,owner:b.owner,version:b.version,reason:"Test finished"});',
      process.cwd(),
      undefined,
      5000,
      {
        executablePath: resolve(import.meta.dir, "../dist/die"),
        jobHandler: async (method, params) => service.handle(method, params, ctx),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("independent work still runs");
    expect(result.stdout).toContain('"foreground":true');
    expect(result.stdout).toContain("undefined");
    expect(service.list(ctx)[0]!.status).toBe("resolved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
