/** Validate the same fixture against actual candidate Effect schemas and root Zod schemas. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import fixture from "../../tests/fixtures/t3-native-task-contract.json";
import sourcePin from "../../web/t3-source.json";
import {
  T3TaskIdInputSchema,
  T3TaskLaunchInputSchema,
  T3TaskListInputSchema,
  T3TaskListResultSchema,
  T3TaskResultSchema,
} from "../../src/tasks/t3-native-task";

const root = resolve(import.meta.dir, "../..");
const candidate = resolve(process.env.T3_V2_CANDIDATE ?? resolve(root, ".cache/die-t3code-" + sourcePin.revision));
const requireCandidate = createRequire(candidate + "/packages/contracts/package.json");
const Schema = await import(pathToFileURL(requireCandidate.resolve("effect/Schema")).href);
const backend = await import(pathToFileURL(candidate + "/packages/contracts/src/orchestratorMcp.ts").href);
const cases = [
  [fixture.launch, T3TaskLaunchInputSchema, backend.DieTaskLaunchInput, T3TaskResultSchema, backend.DieTaskResult],
  [fixture.observe, T3TaskIdInputSchema, backend.DieTaskObserveInput, T3TaskResultSchema, backend.DieTaskResult],
  [fixture.cancel, T3TaskIdInputSchema, backend.DieTaskCancelInput, T3TaskResultSchema, backend.DieTaskResult],
  [fixture.list, T3TaskListInputSchema, backend.DieTaskListInput, T3TaskListResultSchema, backend.DieTaskListResult],
] as const;
for (const [entry, rootInput, backendInput, rootResult, backendResult] of cases) {
  const args = z.parse(rootInput, entry.arguments);
  const decoded = Schema.decodeUnknownSync(backendInput)(entry.arguments, { onExcessProperty: "error" });
  assert.deepEqual(decoded, args, entry.tool + " input mismatch");
  const result = Schema.decodeUnknownSync(backendResult)(entry.result, { onExcessProperty: "error" });
  assert.deepEqual(z.parse(rootResult, result), entry.result, entry.tool + " result mismatch");
  console.log("PASS actual candidate/root schema: " + entry.tool);
}

const workspaceLaunch = {
  ...fixture.launch.arguments,
  title: "Independent parser work",
  workspace: { kind: "worktree", baseRef: "a".repeat(40), branch: "die/parser" },
};
assert.deepEqual(
  Schema.decodeUnknownSync(backend.DieTaskLaunchInput)(workspaceLaunch, { onExcessProperty: "error" }),
  z.parse(T3TaskLaunchInputSchema, workspaceLaunch),
);
for (const preparationStatus of ["preparing", "ready", "failed", "uncertain"]) {
  const result = {
    ...fixture.launch.result,
    workspace: {
      kind: "worktree",
      baseRef: "a".repeat(40),
      branch: "die/parser",
      worktreePath: "/private/worktrees/parser",
      preparationStatus,
    },
  };
  assert.deepEqual(
    Schema.decodeUnknownSync(backend.DieTaskResult)(result, { onExcessProperty: "error" }),
    z.parse(T3TaskResultSchema, result),
  );
}
for (const workspace of [
  { kind: "inherit", branch: "unexpected" },
  { kind: "worktree", approved: true },
]) {
  const input = { ...fixture.launch.arguments, workspace };
  assert.throws(() => z.parse(T3TaskLaunchInputSchema, input));
  assert.throws(() => Schema.decodeUnknownSync(backend.DieTaskLaunchInput)(input, { onExcessProperty: "error" }));
}
console.log("PASS canonical/root structured workspace input, preparation states, and excess-field rejection");
