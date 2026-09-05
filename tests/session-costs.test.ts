import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionCostTracker } from "../src/tasks/session-costs";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const line = (value: unknown) => JSON.stringify(value) + "\n";
const usage = (total: number) => ({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total } });
const assistant = (total: number) => ({ type: "message", message: { role: "assistant", usage: usage(total) } });
const tool = (total: number) => ({ type: "message", message: { role: "toolResult", usage: usage(total) } });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "die-session-costs-"));
  dirs.push(dir);
  const root = join(dir, "root.jsonl");
  await writeFile(root, line({ type: "session", version: 3 }));
  return { dir, root };
}

async function session(path: string, parent: string, entries: unknown[], dieAgent = true) {
  await writeFile(
    path,
    [
      { type: "session", version: 3, parentSession: parent },
      ...(dieAgent ? [{ type: "custom", customType: "die-agent", data: { parentSessionFile: parent } }] : []),
      ...entries,
    ]
      .map(line)
      .join(""),
  );
}

describe("SessionCostTracker", () => {
  test("recursively sums each die-agent descendant once and excludes unrelated sessions, branches, and cycles", async () => {
    const { dir, root } = await fixture();
    const child = join(dir, "child.jsonl");
    const grandchild = join(dir, "grandchild.jsonl");
    await session(child, root, [
      assistant(1),
      tool(2),
      { type: "compaction", usage: usage(3) },
      { type: "branch_summary", usage: usage(4) },
    ]);
    await session(grandchild, child, [assistant(5)]);
    await session(join(dir, "unrelated.jsonl"), join(dir, "other-root.jsonl"), [assistant(100)]);
    // Pi branches have parentSession too, but are not spawned die agents.
    await session(join(dir, "ordinary-branch.jsonl"), root, [assistant(100)], false);
    const cycleA = join(dir, "cycle-a.jsonl"),
      cycleB = join(dir, "cycle-b.jsonl");
    await session(cycleA, cycleB, [assistant(100)]);
    await session(cycleB, cycleA, [assistant(100)]);

    const tracker = new SessionCostTracker(root, dir);
    expect(await tracker.refresh()).toBe(15);
    expect(tracker.descendantCost).toBe(15);
    expect(await tracker.refresh()).toBe(15);
  });

  test("resumes existing JSONL and incrementally includes appended partial usage from failed or killed children", async () => {
    const { dir, root } = await fixture();
    const child = join(dir, "child.jsonl");
    await session(child, root, [assistant(1)]);
    const tracker = new SessionCostTracker(root, dir);
    expect(await tracker.refresh()).toBe(1);

    await appendFile(
      child,
      line(tool(2)) + line({ type: "message", message: { role: "user" } }) + '{"type":"compaction","usage":',
    );
    expect(await tracker.refresh()).toBe(3);
    expect(await tracker.refresh()).toBe(3);
    await appendFile(
      child,
      JSON.stringify(usage(4)) + "}\n" + "not json\n" + line({ type: "branch_summary", usage: usage(5) }),
    );
    expect(await tracker.refresh()).toBe(12);
  });

  test("discovers later nested sessions, honors header fallback only for die agents, and ignores root cost", async () => {
    const { dir, root } = await fixture();
    await appendFile(root, line(assistant(50)));
    const tracker = new SessionCostTracker(root, dir);
    expect(await tracker.refresh()).toBe(0);

    const child = join(dir, "child.jsonl");
    await writeFile(
      child,
      [
        line({ type: "session", version: 3, parentSession: root }),
        line({ type: "custom", customType: "die-agent", data: {} }),
        line(assistant(2)),
      ].join(""),
    );
    expect(await tracker.refresh()).toBe(2);

    const nestedDir = join(dir, "nested");
    await (await import("node:fs/promises")).mkdir(nestedDir);
    await session(join(nestedDir, "grandchild.jsonl"), child, [assistant(3)]);
    expect(await tracker.refresh()).toBe(5);
  });

  test("rejects an ordinary fork that copied die-agent metadata", async () => {
    const { dir, root } = await fixture();
    const child = join(dir, "child.jsonl");
    await session(child, root, [assistant(2)]);

    // A real fork/clone gets a new session header, but copies the source entries,
    // including its custom die-agent record and usage.
    const fork = join(dir, "fork.jsonl");
    await writeFile(
      fork,
      [
        line({ type: "session", version: 3, parentSession: child }),
        line({ type: "custom", customType: "die-agent", data: { parentSessionFile: root } }),
        line(assistant(2)),
        line(assistant(100)),
      ].join(""),
    );

    const tracker = new SessionCostTracker(root, dir);
    expect(await tracker.refresh()).toBe(2);
  });

  test("sanitizes negative costs and deduplicates repeated entry ids per session", async () => {
    const { dir, root } = await fixture();
    const child = join(dir, "child.jsonl");
    await session(child, root, [
      { ...assistant(-4), id: "negative" },
      { ...assistant(3), id: "same" },
      { ...assistant(3), id: "same" },
      { ...tool(2), id: "other" },
    ]);
    const tracker = new SessionCostTracker(root, dir);
    expect(await tracker.refresh()).toBe(5);
  });

  test("resets costs after truncation and atomic replacement", async () => {
    const { dir, root } = await fixture();
    const child = join(dir, "child.jsonl");
    await session(child, root, [assistant(8), assistant(9)]);
    const tracker = new SessionCostTracker(root, dir);
    expect(await tracker.refresh()).toBe(17);

    await session(child, root, [assistant(2)]); // writeFile truncates in place
    expect(await tracker.refresh()).toBe(2);

    const replacement = join(dir, "replacement.tmp");
    await session(replacement, root, [assistant(4)]);
    await rename(replacement, child);
    expect(await tracker.refresh()).toBe(4);
  });

  test("coalesces concurrent refreshes and supports a synthetic missing root", async () => {
    const { dir } = await fixture();
    const missingRoot = join(dir, "synthetic-root.jsonl");
    const child = join(dir, "child.jsonl");
    await session(child, missingRoot, [assistant(6)]);
    const tracker = new SessionCostTracker(missingRoot, dir);
    const first = tracker.refresh();
    const second = tracker.refresh();
    expect(second).toBe(first);
    expect(await Promise.all([first, second])).toEqual([6, 6]);
    expect(await tracker.refresh()).toBe(6);
  });
});

test("counts failed compaction usage once without treating arbitrary custom entries as costs", async () => {
  const { dir, root } = await fixture();
  const failed = { id: "attempt", type: "custom", customType: "die-compaction-attempt", data: { usage: usage(2) } };
  await session(join(dir, "child.jsonl"), root, [
    failed,
    failed,
    { type: "custom", customType: "other", data: { usage: usage(100) } },
  ]);
  const tracker = new SessionCostTracker(root, dir);
  expect(await tracker.refresh()).toBe(2);
  expect(await tracker.refresh()).toBe(2);
});
