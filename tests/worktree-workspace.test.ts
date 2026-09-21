import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobService } from "../src/tasks/job-service";
import { TaskManager } from "../src/tasks/task-manager";
import { createWorktree, parseJsonc, readWorktreeSetup, resolveWorktreeSource } from "../src/tasks/worktree-workspace";

const owned: string[] = [];
afterEach(async () => {
  await Promise.all(owned.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "die-worktree-test-"));
  owned.push(root);
  const repo = join(root, "repo");
  execFileSync("mkdir", [repo]);
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Die Test"]);
  await writeFile(join(repo, "tracked.txt"), "committed\n");
  execFileSync("git", ["-C", repo, "add", "tracked.txt"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "base"]);
  return { root, repo, worktrees: join(root, "worktrees") };
}

describe("local worktree workspace", () => {
  test("parses JSONC setup and preserves async false", async () => {
    const { repo } = await fixture();
    await writeFile(
      join(repo, "t3.json"),
      String.raw`{
      // portable setup
      "scripts": [{
        "name": "setup",
        "command": "printf ',} // literal' > setup.txt",
        "runOnWorktreeCreate": true,
        "async": false,
      }],
    }`,
    );
    expect(parseJsonc('{"value": "//,}",}')).toEqual({ value: "//,}" });
    expect(await readWorktreeSetup(repo)).toMatchObject({
      command: "printf ',} // literal' > setup.txt",
      async: false,
      configDigest: expect.any(String),
    });
  });

  test("pins one commit and creates argv-safe retained branches without dirty files", async () => {
    const { repo, worktrees } = await fixture();
    await writeFile(join(repo, "tracked.txt"), "dirty\n");
    await writeFile(join(repo, "secret.env"), "not copied\n");
    const source = await resolveWorktreeSource(repo);
    const first = await createWorktree(source, {
      taskId: "task_one",
      title: "feature; touch PWNED",
      root: worktrees,
    });
    const second = await createWorktree(source, { taskId: "task_two", root: worktrees });
    expect(first.baseOid).toBe(second.baseOid);
    expect(first.path).not.toBe(second.path);
    expect(first.branch).toMatch(/^die\/feature-touch-pwned-/);
    expect(await readFile(join(first.path, "tracked.txt"), "utf8")).toBe("committed\n");
    await expect(readFile(join(first.path, "secret.env"), "utf8")).rejects.toThrow();
    expect(execFileSync("git", ["-C", first.path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(
      source.baseOid,
    );
  });

  test("rejects one explicit branch for a prompt batch before workspace side effects", async () => {
    const manager = new TaskManager(() => {});
    const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined, {});
    try {
      await expect(
        service.handle(
          "subagent",
          { prompts: ["one", "two"], workspace: { kind: "worktree", branch: "one-branch" } },
          { cwd: tmpdir() } as never,
          new AbortController().signal,
        ),
      ).rejects.toThrow("only valid for a single prompt");
      expect(manager.list()).toHaveLength(0);
    } finally {
      await manager.shutdown();
    }
  });

  test("rejects option/control refs, invalid task identities, and managed path collisions", async () => {
    const { repo, worktrees } = await fixture();
    await expect(resolveWorktreeSource(repo, "--help")).rejects.toThrow("Invalid worktree base ref");
    await expect(resolveWorktreeSource(repo, "HEAD\nmain")).rejects.toThrow("Invalid worktree base ref");
    const source = await resolveWorktreeSource(repo);
    await expect(createWorktree(source, { taskId: "task_ok/alias", root: worktrees })).rejects.toThrow(
      "Invalid workspace task ID",
    );
    await expect(createWorktree(source, { taskId: "task_bad", branch: "-bad", root: worktrees })).rejects.toThrow(
      "Invalid worktree branch",
    );
    const first = await createWorktree(source, { taskId: "task_collision", root: worktrees });
    await expect(
      createWorktree(source, { taskId: "task_collision", branch: "another", root: worktrees }),
    ).rejects.toThrow("already exists");
    expect(first.path).toContain(worktrees);
  });

  test("rejects branch reuse rather than resetting it", async () => {
    const { repo, worktrees } = await fixture();
    const source = await resolveWorktreeSource(repo);
    await createWorktree(source, { taskId: "task_one", branch: "kept", root: worktrees });
    await expect(createWorktree(source, { taskId: "task_two", branch: "kept", root: worktrees })).rejects.toThrow(
      "already exists",
    );
  });
  test("waitSeconds zero returns a cancellable child while blocking setup is still preparing", async () => {
    const { repo, worktrees } = await fixture();
    await writeFile(
      join(repo, "t3.json"),
      JSON.stringify({
        scripts: [
          {
            name: "setup",
            command: "sleep 30",
            runOnWorktreeCreate: true,
            async: false,
          },
        ],
      }),
    );
    const oldRoot = process.env.DIE_WORKTREE_ROOT;
    process.env.DIE_WORKTREE_ROOT = worktrees;
    const manager = new TaskManager(() => {}, 25);
    const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined, {});
    try {
      const started = Date.now();
      const result = (await service.handle(
        "subagent",
        {
          prompt: "blocked",
          workspace: { kind: "worktree" },
          waitSeconds: 0,
        },
        { cwd: repo, model: { provider: "test", id: "model" }, isProjectTrusted: () => true } as never,
        new AbortController().signal,
      )) as { id: string; workspace: { preparationStatus: string } };
      expect(Date.now() - started).toBeLessThan(2000);
      expect(result.id).toMatch(/^task_/);
      expect(result.workspace.preparationStatus).toBe("preparing");
      for (let attempt = 0; attempt < 100 && !manager.inspect(result.id).workspace?.setupTaskId; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      manager.kill(result.id);
      const stopped = await manager.wait(result.id);
      expect(stopped.status).toBe("killed");
      expect(stopped.workspace?.preparationStatus).toBe("failed");
      expect(stopped.workspace?.setupTaskId).toBeTruthy();
      if (stopped.workspace?.setupTaskId)
        expect((await manager.wait(stopped.workspace.setupTaskId)).status).toBe("killed");
    } finally {
      await manager.shutdown();
      if (oldRoot === undefined) delete process.env.DIE_WORKTREE_ROOT;
      else process.env.DIE_WORKTREE_ROOT = oldRoot;
    }
  });

  test("the child deadline includes worktree setup and prevents provider start", async () => {
    const { repo, worktrees } = await fixture();
    await writeFile(
      join(repo, "t3.json"),
      JSON.stringify({
        scripts: [
          {
            name: "setup",
            command: "sleep 30",
            runOnWorktreeCreate: true,
            async: false,
          },
        ],
      }),
    );
    const oldRoot = process.env.DIE_WORKTREE_ROOT;
    process.env.DIE_WORKTREE_ROOT = worktrees;
    const manager = new TaskManager(() => {}, 25);
    const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined, {});
    try {
      const result = (await service.handle(
        "subagent",
        {
          prompt: "timeout",
          workspace: { kind: "worktree" },
          waitSeconds: 0,
          timeoutSeconds: 0.1,
        },
        { cwd: repo, model: { provider: "test", id: "model" }, isProjectTrusted: () => true } as never,
        new AbortController().signal,
      )) as { id: string };
      const stopped = await manager.wait(result.id);
      expect(stopped.status).toBe("killed");
      expect(stopped.timedOut).toBe(true);
      expect(stopped.pid).toBeUndefined();
      expect(stopped.workspace?.preparationError).toBe("timed out");
    } finally {
      await manager.shutdown();
      if (oldRoot === undefined) delete process.env.DIE_WORKTREE_ROOT;
      else process.env.DIE_WORKTREE_ROOT = oldRoot;
    }
  });

  test("repository setup runs automatically without trust approval while child trust remains denied", async () => {
    const { root, repo, worktrees } = await fixture();
    const markerPath = join(root, "setup-ran");
    await writeFile(
      join(repo, "t3.json"),
      JSON.stringify({
        scripts: [
          {
            name: "setup",
            command: "touch " + markerPath,
            runOnWorktreeCreate: true,
            async: false,
          },
        ],
      }),
    );
    const oldRoot = process.env.DIE_WORKTREE_ROOT;
    process.env.DIE_WORKTREE_ROOT = worktrees;
    const manager = new TaskManager(() => {}, 25);
    const activate = spyOn(manager, "activatePreparedAgent");
    const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined, {});
    try {
      const result = (await service.handle(
        "subagent",
        {
          prompt: "untrusted",
          workspace: { kind: "worktree" },
          waitSeconds: 0,
        },
        { cwd: repo, model: { provider: "test", id: "model" }, isProjectTrusted: () => false } as never,
        new AbortController().signal,
      )) as { id: string };
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = manager.inspect(result.id);
        if (current.workspace?.setupStatus === "completed" && current.workspace.preparationStatus !== "preparing")
          break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const current = manager.inspect(result.id);
      expect(current.workspace?.setupStatus).toBe("completed");
      expect((activate.mock.calls[0]?.[1] as { args?: string[] } | undefined)?.args).toContain("--no-approve");
      expect(await readFile(markerPath, "utf8")).toBe("");
      if (current.status === "running") manager.kill(result.id);
    } finally {
      await manager.shutdown();
      if (oldRoot === undefined) delete process.env.DIE_WORKTREE_ROOT;
      else process.env.DIE_WORKTREE_ROOT = oldRoot;
    }
  });

  test("a synchronous setup failure retains every batch identity without killing siblings", async () => {
    const { repo, worktrees } = await fixture();
    await writeFile(
      join(repo, "t3.json"),
      JSON.stringify({
        scripts: [
          {
            name: "setup",
            command: "case $(git branch --show-current) in *agent-2*) exit 9;; esac",
            runOnWorktreeCreate: true,
            async: false,
          },
        ],
      }),
    );
    const oldRoot = process.env.DIE_WORKTREE_ROOT;
    process.env.DIE_WORKTREE_ROOT = worktrees;
    const manager = new TaskManager(() => {}, 25);
    const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined, {});
    try {
      const results = (await service.handle(
        "subagent",
        {
          prompts: ["one", "two", "three"],
          workspace: { kind: "worktree" },
          waitSeconds: 0,
        },
        { cwd: repo, model: { provider: "test", id: "model" }, isProjectTrusted: () => true } as never,
        new AbortController().signal,
      )) as Array<{ id: string }>;
      expect(new Set(results.map((item) => item.id)).size).toBe(3);
      const second = await manager.wait(results[1].id);
      expect(second.status).toBe("failed");
      expect(second.workspace?.path).not.toBe(repo);
      expect(manager.inspect(results[0].id).termination).toBeUndefined();
      expect(manager.inspect(results[2].id).termination).toBeUndefined();
    } finally {
      await manager.shutdown();
      if (oldRoot === undefined) delete process.env.DIE_WORKTREE_ROOT;
      else process.env.DIE_WORKTREE_ROOT = oldRoot;
    }
  });
});
