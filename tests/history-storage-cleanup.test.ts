import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("temporary preparation and failed factories leave no live-process pending journals", async () => {
  const root = await mkdtemp(join(tmpdir(), "die-history-cleanup-"));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        String.raw`
      import { strict as assert } from "node:assert";
      import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
      import { join } from "node:path";
      import { SessionManager } from "@earendil-works/pi-coding-agent";
      import { DiskEntryStore } from "./src/history/disk-entry-store.ts";
      import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "./src/history/session-manager.ts";
      import { prepareAgentSession } from "./src/tasks/agent-session.ts";
      installDiskBackedSessionManager();
      const root = process.env.PROBE_ROOT;
      const pending = () => readdirSync(root, {recursive:true}).filter(p => String(p).includes(".pending-"));
      const clean = () => assert.deepEqual(pending(), []);
      const info = {type:"fast", model:"p/model", depth:1, parentSessionFile:"/parent.jsonl"};
      const prepared = await prepareAgentSession(root, root, info);
      clean();
      const saved = SessionManager.open(prepared.agent.sessionFile);
      assert.equal(saved.getHeader().parentSession, info.parentSessionFile);
      assert.equal(saved.getEntries().length, 2);
      disposeDiskBackedSessionManager(saved);
      clean();

      const originalOpen = SessionManager.open;
      SessionManager.open = () => { throw new Error("injected prepare reopen"); };
      try { await assert.rejects(prepareAgentSession(root, root, info), /injected prepare reopen/); }
      finally { SessionManager.open = originalOpen; }
      clean();

      const originalCreate = SessionManager.create;
      let collision;
      SessionManager.create = (...args) => {
        const manager = originalCreate(...args);
        collision = manager.getSessionFile();
        writeFileSync(collision, "sentinel");
        return manager;
      };
      try { await assert.rejects(prepareAgentSession(root, root, info), /EEXIST/); }
      finally { SessionManager.create = originalCreate; }
      assert.equal(readFileSync(collision, "utf8"), "sentinel");
      clean();

      const empty = join(root, "empty.jsonl"); writeFileSync(empty, "");
      const published = DiskEntryStore.published;
      DiskEntryStore.published = () => { throw new Error("injected publication"); };
      try {
        assert.throws(() => SessionManager.open(empty), /injected publication/);
        clean();
        assert.throws(() => SessionManager.forkFrom(prepared.agent.sessionFile, root, root), /injected publication/);
        clean();
      } finally { DiskEntryStore.published = published; }
      assert.equal(readFileSync(empty, "utf8"), "");

      const makePending = DiskEntryStore.pending;
      let pendingCalls = 0;
      DiskEntryStore.pending = (...args) => {
        if (++pendingCalls === 2) throw new Error("injected replacement pending");
        return makePending(...args);
      };
      try { assert.throws(() => SessionManager.open(join(root, "missing.jsonl")), /injected replacement pending/); }
      finally { DiskEntryStore.pending = makePending; }
      clean();
      const append = DiskEntryStore.prototype.append;
      DiskEntryStore.prototype.append = () => { throw new Error("injected fork copy"); };
      try { assert.throws(() => SessionManager.forkFrom(prepared.agent.sessionFile, root, root), /injected fork copy/); }
      finally { DiskEntryStore.prototype.append = append; }
      clean();

      const dir = join(root, "recent"); mkdirSync(dir);
      const candidate = join(dir, "candidate.jsonl");
      writeFileSync(candidate, JSON.stringify({type:"session",version:3,id:"recent",timestamp:"x",cwd:root}) + "\n");
      const open = DiskEntryStore.open;
      DiskEntryStore.open = () => { throw new Error("injected selected load"); };
      try { assert.throws(() => SessionManager.continueRecent(root, dir), /injected selected load/); }
      finally { DiskEntryStore.open = open; }
      clean();

      const RealDate = Date;
      globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ["2026-01-01T00:00:00.000Z"])); } };
      try {
        const manager = SessionManager.create(root, root, {id:"collision-target"});
        manager._rewriteFile();
        const path = manager.getSessionFile(), before = readFileSync(path, "utf8");
        assert.throws(() => SessionManager.forkFrom(prepared.agent.sessionFile, root, root, {id:"collision-target"}), /EEXIST/);
        assert.equal(readFileSync(path, "utf8"), before);
        clean();
      } finally { globalThis.Date = RealDate; }
      const fresh = SessionManager.create(root, root);
      fresh.appendMessage({role:"user",content:"still owned",timestamp:1});
      assert.equal(pending().length, 1);
      assert.equal(fresh.getEntries()[0].message.content, "still owned");
      disposeDiskBackedSessionManager(fresh);
      clean();
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
