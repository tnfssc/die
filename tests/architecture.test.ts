import { expect, test } from "bun:test";
import { resolve, relative, sep } from "node:path";

const root = resolve(import.meta.dir, "..");
const transpiler = new Bun.Transpiler({ loader: "ts" });

async function runtimeEdges() {
  const edges: { source: string; target: string }[] = [];
  for await (const path of new Bun.Glob("**/*.ts").scan({ cwd: resolve(root, "src") })) {
    if (path.endsWith(".d.ts")) continue;
    const absolute = resolve(root, "src", path);
    for (const dependency of transpiler.scanImports((await Bun.file(absolute).text()).replace(/^#![^\n]*\n/, ""))) {
      if (!dependency.path.startsWith(".")) continue;
      edges.push({
        source: "src/" + path.split(sep).join("/"),
        target: relative(root, resolve(absolute, "..", dependency.path))
          .split(sep)
          .join("/"),
      });
    }
  }
  return edges;
}

test("runtime never imports build tools or archived research", async () => {
  const bad = (await runtimeEdges()).filter(
    ({ target }) =>
      /^(?:scripts|experiments|\.agents)\//.test(target) || /^integrations\/t3\/(?:build|gates)\//.test(target),
  );
  expect(bad).toEqual([]);
});

test("history and shared session contracts do not import feature controllers", async () => {
  const bad = (await runtimeEdges()).filter(
    ({ source, target }) =>
      /^src\/(?:history|session)\//.test(source) && /^src\/(?:agent|tasks|live|t3)\//.test(target),
  );
  expect(bad).toEqual([]);
});

test("T3 adapters cannot become another task execution owner", async () => {
  // Type-only TaskEvent references are fine. scanImports returns runtime edges.
  const bad = (await runtimeEdges()).filter(
    ({ source, target }) =>
      source.startsWith("src/t3/") &&
      (/^src\/tasks\/(?:task-manager|job-service)(?:\.ts)?$/.test(target) || target.startsWith("src/agent/")),
  );
  expect(bad).toEqual([]);
});

test("active T3 inputs and agent composition have one maintained home", async () => {
  for (const path of [
    "src/agent/extension.ts",
    "src/history/shake-record.ts",
    "src/t3/tasks/mcp-client.ts",
    "src/t3/tasks/native-task.ts",
    "src/t3/web/embedded.ts",
    "integrations/t3/upstream/source.json",
    "integrations/t3/upstream/die.patch",
    "integrations/t3/upstream/bootstrap.mjs",
    "integrations/t3/build/build.ts",
    "integrations/t3/build/verify-source.ts",
    "integrations/t3/fixtures/native-task-contract.json",
  ])
    expect({ path, exists: await Bun.file(resolve(root, path)).exists() }).toEqual({ path, exists: true });
  for (const path of [
    "src/tasks/extension.ts",
    "src/tasks/manual-shake.ts",
    "src/tasks/t3-mcp-client.ts",
    "src/tasks/t3-native-task.ts",
    "src/web/embedded.ts",
    "web/t3-source.json",
    "web/t3.patch",
    "web/die-web-bootstrap.mjs",
    "scripts/build-web.ts",
    "scripts/web-source.ts",
  ])
    expect({ path, exists: await Bun.file(resolve(root, path)).exists() }).toEqual({ path, exists: false });
});
