import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("disk history retrieval traverses metadata, preserving originals, branches, refs and live exclusions", async () => {
  const root = await mkdtemp(join(tmpdir(), "die-disk-retrieval-"));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        String.raw`
      import { SessionManager } from "@earendil-works/pi-coding-agent";
      import { installDiskBackedSessionManager } from "./src/history/session-manager.ts";
      import { HistoryService } from "./src/history/service.ts";
      import { MANUAL_SHAKE_ENTRY, MANUAL_SHAKE_VERSION } from "./src/history/shake-record.ts";
      import { strict as assert } from "node:assert";
      installDiskBackedSessionManager();
      const manager = SessionManager.create(process.env.PROBE_ROOT, process.env.PROBE_ROOT);
      const user = (content) => ({ role: "user", content, timestamp: Date.now() });
      const first = manager.appendMessage(user("original exact evidence needle"));
      manager.appendMessage(user("inactive-secret-needle"));
      manager.branch(first);
      const assistant = manager.appendMessage({role:"assistant", api:"openai-responses",provider:"test",model:"test",content:[
        {type:"thinking",thinking:"private-reasoning-needle"},
        {type:"toolCall",id:"call",name:"execute",arguments:{text:"private-payload-needle"}},
        {type:"text",text:"public-needle"}
      ],stopReason:"stop",usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now()});
      const tool = manager.appendMessage({role:"toolResult",toolCallId:"call",toolName:"execute",content:[{type:"text",text:"result-needle"}],isError:false,timestamp:Date.now()});
      manager.appendCustomMessageEntry("hidden", "hidden-custom-needle", false);
      const tail = manager.appendMessage(user("kept tail"));
      manager.appendCompaction("summary",tail,10000);
      const path = manager.getSessionFile();
      manager.setSessionFile(path);
      manager.getBranch = () => { throw new Error("full body branch must not be requested by history"); };
      const service = new HistoryService();
      const ctx = {sessionManager:manager};
      const search = (query, extra={}) => service.search({query,...extra},ctx);
      const original = (await search("original exact")).matches[0];
      assert.equal((await service.read({ref:original.ref},ctx)).text,"original exact evidence needle");
      for(const hidden of ["inactive-secret-needle","private-reasoning-needle","private-payload-needle","hidden-custom-needle"])
        assert.equal((await search(hidden)).matches.length,0);
      const priorTool = (await search("result-needle")).matches[0];
      const page = await search("needle", {limit:1});
      manager.appendCustomEntry(MANUAL_SHAKE_ENTRY,{version:MANUAL_SHAKE_VERSION,sessionId:manager.getSessionId(),assistantEntryIds:[assistant],toolResultEntryIds:[tool],shakenAt:Date.now()});
      assert.equal((await search("result-needle")).matches.length,0);
      await assert.rejects(service.read({ref:priorTool.ref},ctx),/excluded|unavailable/);
      if(page.nextCursor) assert.ok((await search("needle",{limit:1,cursor:page.nextCursor})).matches.every(m=>m.provenance.entryId!==tool));
      manager.setSessionFile(path);
      assert.equal((await search("result-needle")).matches.length,0);
      assert.equal((await search("public-needle")).matches.length,1);
      assert.equal((await service.read({ref:original.ref},ctx)).text,"original exact evidence needle");
      console.log("ok");
    `,
      ],
      { cwd: join(import.meta.dir, ".."), env: { ...process.env, PROBE_ROOT: root }, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout.trim()).toBe("ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
