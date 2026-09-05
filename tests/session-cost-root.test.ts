import { test, expect } from "bun:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { sessionCostRoot } from "../src/tasks/session-cost-root";

test("cost root preserves persistent identity and gives ephemeral sessions distinct stable identities", () => {
  const persisted = SessionManager.create(process.cwd());
  expect(sessionCostRoot(persisted)).toEqual({
    file: persisted.getSessionFile()!,
    directory: persisted.getSessionDir(),
  });
  const ephemeral = SessionManager.inMemory(process.cwd());
  const identity = sessionCostRoot(ephemeral)!;
  expect(identity.directory).toBe(persisted.getSessionDir());
  expect(sessionCostRoot(ephemeral)).toEqual(identity);
  expect(sessionCostRoot(SessionManager.inMemory(process.cwd()))!.file).not.toBe(identity.file);
  expect(ephemeral.getSessionFile()).toBeUndefined();
});
