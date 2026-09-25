import { test, expect } from "bun:test";
import { mkdir, rm, readdir, readFile } from "node:fs/promises";
import { SNAPSHOT_DIR, SessionHost, type SessionAuthority } from "../src/session/host";

function fixture() {
  const sent: string[] = [];
  const stopped: string[] = [];
  let confirm!: (value: boolean) => void;
  const confirmation = new Promise<boolean>((resolve) => { confirm = resolve; });
  let events!: (event: any) => void;
  const manager = {
    getSessionId: () => "same-session",
    getSessionFile: () => "/tmp/same-session",
    getLeafId: () => "leaf",
    getBranch: () => [] as any[],
  };
  const host = new SessionHost({
    context: { sessionManager: manager } as any,
    tasks: {
      list: async () => ({ jobs: [] }),
      inspect: async (id) => ({ id }),
      stop: async (id) => { stopped.push(id); return { id }; },
      localJobs: () => [],
      subscribe: (fn) => { events = fn; return () => {}; },
    },
    sendUserMessage: (message) => { sent.push(message); },
    confirmStop: () => confirmation,
  } satisfies SessionAuthority);
  return { host, manager, sent, stopped, confirm, emit: () => events({ type: "spawned", task: { id: "job", status: "running" } }) };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("independent host leases revoke pending dispatch and subscriptions without closing host", async () => {
  const f = fixture();
  const a = f.host.lease();
  const b = f.host.lease();
  let heard = 0;
  a.subscribe(() => heard++);
  b.subscribe(() => heard++);
  f.emit();
  expect(heard).toBe(2);
  const pending = a.send("same", "first");
  a.revoke();
  a.revoke();
  await expect(pending).rejects.toThrow("revoked");
  f.emit();
  expect(heard).toBe(3);
  expect(() => a.context()).toThrow("revoked");
  expect(() => a.subscribe(() => {})).toThrow("revoked");
  await expect(a.list()).rejects.toThrow("revoked");
  await expect(a.inspect("job")).rejects.toThrow("revoked");
  await expect(a.send("new", "no")).rejects.toThrow("revoked");
  await expect(a.steer("new", "no")).rejects.toThrow("revoked");
  await b.send("same", "second");
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0]).toContain("second");
  expect(f.host.context().requestCount).toBe(2);
  b.revoke();
  await f.host.send("cli", "still works");
  expect(f.sent).toHaveLength(2);
  f.host.close();
});

test("revocation after stop confirmation prevents cancellation", async () => {
  const f = fixture();
  const lease = f.host.lease();
  const pending = lease.stop("stop", "job");
  await tick();
  lease.revoke();
  f.confirm(true);
  await expect(pending).rejects.toThrow("revoked");
  expect(f.stopped).toEqual([]);
  f.host.close();
});

test("revocation during transcript snapshot prevents send and steer", async () => {
  const f = fixture();
  let entries = Array.from({ length: 150 }, (_, i) => ({
    type: "custom", customType: "die:voice-transcript", data: { speaker: "You", text: String(i).padEnd(300, "x"), status: "final" },
  }));
  // Use the actual entry name from the host's transcript contract.
  const { VOICE_ENTRY } = await import("../src/session/transcript");
  for (const entry of entries) entry.customType = VOICE_ENTRY;
  // Shared snapshot storage may be full; reuse existing content without deleting it.
  for (const name of await readdir(SNAPSHOT_DIR).catch(() => [] as string[])) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    try {
      const saved = JSON.parse(await readFile(SNAPSHOT_DIR + "/" + name, "utf8"));
      if (saved.source === "received live transcription (not agent dialogue or verified heard audio)" &&
          saved.entries?.length && JSON.stringify(saved.entries).length > 24000 && !saved.unreadableEntries) {
        entries = saved.entries.map((data: any) => ({ type: "custom", customType: VOICE_ENTRY, data }));
        break;
      }
    } catch { /* Ignore unrelated/corrupt snapshots. */ }
  }
  f.manager.getBranch = () => entries;
  // Hold snapshot creation at its filesystem lock until the lease is revoked.
  await mkdir(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
  const lock = SNAPSHOT_DIR + "/.lock";
  await mkdir(lock);
  try {
    const lease = f.host.lease();
    const send = lease.send("one", "work");
    const steer = lease.steer("two", "steer");
    await new Promise((resolve) => setTimeout(resolve, 15));
    lease.revoke();
    await rm(lock, { recursive: true });
    await expect(send).rejects.toThrow("revoked");
    await expect(steer).rejects.toThrow("revoked");
    expect(f.sent).toEqual([]);
    expect(f.host.context().requestCount).toBe(2);
  } finally {
    await rm(lock, { recursive: true, force: true });
    f.host.close();
  }
});

test("lease retries dedupe locally but never reset the host request budget", async () => {
  const f = fixture();
  const first = f.host.lease();
  await first.send("repeat", "work");
  await first.send("repeat", "work");
  expect(f.sent).toHaveLength(1);
  first.revoke();
  const next = f.host.lease();
  await next.send("repeat", "work");
  expect(f.sent).toHaveLength(2);
  for (let i = 0; i < 254; i++) await next.send("r" + i, "work");
  expect(f.host.context().requestCount).toBe(256);
  next.revoke();
  await expect(f.host.lease().send("more", "work")).rejects.toThrow("capacity");
  expect(f.sent).toHaveLength(256);
  f.host.close();
});
