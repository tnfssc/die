import { test, expect } from "bun:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { sessionIdentity } from "../src/session/identity";

test("session identity preserves persistent paths and gives ephemeral sessions distinct stable identities", () => {
  const persisted = SessionManager.create(process.cwd());
  expect(sessionIdentity(persisted)).toEqual({
    file: persisted.getSessionFile()!,
    directory: persisted.getSessionDir(),
  });
  const ephemeral = SessionManager.inMemory(process.cwd());
  const identity = sessionIdentity(ephemeral)!;
  expect(identity.directory).toBe(persisted.getSessionDir());
  expect(sessionIdentity(ephemeral)).toEqual(identity);
  expect(sessionIdentity(SessionManager.inMemory(process.cwd()))!.file).not.toBe(identity.file);
  expect(ephemeral.getSessionFile()).toBeUndefined();
});
