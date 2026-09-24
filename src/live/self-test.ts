/** Release diagnostic: never sends start, opens devices, or contacts a provider. */
import { spawnSync } from "node:child_process";
import { audioEnvironment } from "./audio";
import { resolveEmbeddedNativeHelper } from "./helper";
export async function testEmbeddedNativeHelper(): Promise<void> {
  const helper = await resolveEmbeddedNativeHelper();
  if (!helper) throw new Error("This build has no embedded native helper for this platform");
  try {
    const options = { encoding: "utf8" as const, env: audioEnvironment(), timeout: 5000, maxBuffer: 65536 };
    const self = spawnSync(helper.path, ["--self-test"], options);
    if (self.status !== 0) throw new Error("Embedded native helper self-test failed");
    const protocol = spawnSync(helper.path, [], { ...options, input: '{"type":"stop"}\n' });
    if (protocol.status !== 0) throw new Error("Embedded native helper protocol test failed");
    const messages = protocol.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (messages[0]?.type !== "hello" || messages[0]?.protocol !== 1 || !messages.some((m) => m.type === "stopped"))
      throw new Error("Embedded native helper protocol mismatch");
    console.log("Embedded native helper self-test and protocol v1 passed (no devices)");
  } finally {
    await helper.cleanup();
  }
}
