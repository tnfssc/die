/** Isolated retention probe; no existing session or files are touched. */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { heapStats } from "bun:jsc";
import { randomBytes } from "node:crypto";
let manager: SessionManager | undefined = SessionManager.inMemory("/tmp/die-leak-audit");
async function sample(label: string) {
  await Bun.sleep(30);
  Bun.gc(true);
  await Bun.sleep(30);
  Bun.gc(true);
  const m = process.memoryUsage();
  const h = heapStats();
  console.log(
    JSON.stringify({
      label,
      entries: manager?.getEntries().length,
      contextMessages: manager?.buildSessionContext().messages.length,
      jscHeapMiB: +(h.heapSize / 1048576).toFixed(2),
      heapMiB: +(m.heapUsed / 1048576).toFixed(2),
      rssMiB: +(m.rss / 1048576).toFixed(2),
    }),
  );
}
await sample("baseline");
for (let batch = 1; batch <= 4; batch++) {
  for (let i = 0; i < 128; i++)
    manager!.appendMessage({ role: "user", content: randomBytes(48 * 1024).toString("base64"), timestamp: Date.now() });
  const kept = manager!.appendMessage({ role: "user", content: "retained tail", timestamp: Date.now() });
  manager!.appendCompaction("Small summary", kept, 100000);
  await sample("after compaction " + batch);
}
manager!.newSession();
await sample("newSession resets journal");

for (let i = 0; i < 5; i++) {
  await Bun.sleep(200);
  Bun.gc(true);
}
await sample("post-reset settled");
