import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { activateBridgeArgs } from "./bridge-launch-args";
const activation = resolve(import.meta.dir, "bridge-activation.ts");
for (const flags of [["--extension", activation], ["-e", activation], ["--extension="+activation], ["-e="+activation]]) {
  test("activation remains single: " + flags[0], () => {
    const args = ["--mode", "rpc", ...flags];
    expect(activateBridgeArgs(args, activation)).toEqual(args);
  });
}
test("upstream extension retained and activation appended", () => {
  expect(activateBridgeArgs(["--extension", "/tmp/upstream.ts"], activation)).toEqual(["--extension", "/tmp/upstream.ts", "--extension", activation]);
});
