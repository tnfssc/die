import { expect, test } from "bun:test";
import { waitForLiveTuiStartup } from "./live-tui-startup";

test("source CLI startup already ready (clean checkout) sends no trust keys", async () => {
  const keys: string[] = [];
  await waitForLiveTuiStartup(
    async () => "PICKER FIXTURE LOADED",
    async (key) => keys.push(key),
    "PICKER FIXTURE LOADED",
  );
  expect(keys).toEqual([]);
});

test("source CLI trust prompt uses session-only approval before asserting fixture loaded", async () => {
  const keys: string[] = [];
  await waitForLiveTuiStartup(
    async () => (keys.length === 3 ? "GPT FIXTURE LOADED" : "Trust project folder?"),
    async (key) => keys.push(key),
    "GPT FIXTURE LOADED",
  );
  expect(keys).toEqual(["Down", "Down", "Enter"]);
});
