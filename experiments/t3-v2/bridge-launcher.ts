#!/usr/bin/env bun
/** Provider binary for the isolated T3 v2 experiment. T3 supplies RPC flags and its MCP extension. */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { activateBridgeArgs } from "./bridge-launch-args";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const configured = process.env.DIE_T3_DIE_BIN;
const binary = configured ? resolve(configured) : resolve(repo, "dist/die");
if (!existsSync(binary)) {
  console.error("Die binary is missing; run 'bun run build' or set DIE_T3_DIE_BIN.");
  process.exit(127);
}
// PiAdapterV2 appends its session-scoped MCP extension so its approval hooks remain loaded.
// Append guidance/policy only: execute stays the sole visible tool and imports bridge-client.ts
// to reach the same inherited session endpoint. Local CLI arguments remain unchanged.
const activation = resolve(here, "bridge-activation.ts");
const incoming = process.argv.slice(2);
const args = activateBridgeArgs(incoming, activation);
const child = Bun.spawn([binary, ...args], {
  cwd: process.cwd(), env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
