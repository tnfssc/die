import { expect, test } from "bun:test";
import { liveLocalOnly } from "../src/live/status";
test("live is interactive local root CLI only", () => {
  expect(liveLocalOnly("tui", {}, true)).toBe(true);
  for (const mode of ["rpc", "print", "json"]) expect(liveLocalOnly(mode, {}, true)).toBe(false);
  for (const key of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "DIE_WEB_DIE_BINARY", "DIE_SUBAGENT_DEPTH"])
    expect(liveLocalOnly("tui", { [key]: "1" }, true)).toBe(false);
  expect(liveLocalOnly("tui", {}, false)).toBe(false);
});
