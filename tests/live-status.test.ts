import { expect, test } from "bun:test";
import { liveStatus, liveLocalOnly } from "../src/live/status";
test("reactive line has stable width and clamps invalid audio levels", () => {
  expect(liveStatus(0)).toBe("live ────────");
  expect(liveStatus(1)).toBe("live ━━━━━━━━");
  expect(liveStatus(NaN)).toBe(liveStatus(0));
  expect(liveStatus(-1)).toBe(liveStatus(0));
  expect(liveStatus(2)).toBe(liveStatus(1));
});
test("live is interactive local root CLI only", () => {
  expect(liveLocalOnly("tui", {}, true)).toBe(true);
  for (const mode of ["rpc", "print", "json"]) expect(liveLocalOnly(mode, {}, true)).toBe(false);
  for (const key of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "DIE_WEB_DIE_BINARY", "DIE_SUBAGENT_DEPTH"])
    expect(liveLocalOnly("tui", { [key]: "1" }, true)).toBe(false);
  expect(liveLocalOnly("tui", {}, false)).toBe(false);
});
