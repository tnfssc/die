import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dieSystemPrompt } from "../src/prompts";
import { withDieSystemPrompt } from "../src/system-prompt";

test("injects Die base before Pi's positional prompt boundary", () => {
  expect(
    withDieSystemPrompt(["--model", "x", "--", "hello"], {
      cwd: "/missing",
      agentDir: "/missing",
    }),
  ).toEqual(["--model", "x", "--system-prompt", dieSystemPrompt(), "--", "hello"]);
});

test("preserves explicit CLI system prompts", () => {
  const args = ["--system-prompt", "USER_BASE", "question"];
  expect(withDieSystemPrompt(args, { cwd: "/missing", agentDir: "/missing" })).toBe(args);
  const positional = ["--", "--system-prompt", "not-an-option"];
  expect(withDieSystemPrompt(positional, { cwd: "/missing", agentDir: "/missing" })).not.toBe(positional);
});

test("preserves project and global SYSTEM.md overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "die-system-prompt-"));
  try {
    const cwd = join(root, "project"),
      agentDir = join(root, "agent");
    await mkdir(join(cwd, ".die"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(cwd, ".die", "SYSTEM.md"), "PROJECT");
    const projectArgs: string[] = [];
    expect(withDieSystemPrompt(projectArgs, { cwd, agentDir, projectTrusted: true })).toBe(projectArgs);

    const deniedArgs = ["--no-approve"];
    expect(withDieSystemPrompt(deniedArgs, { cwd, agentDir })).toEqual([
      "--no-approve",
      "--system-prompt",
      dieSystemPrompt(),
    ]);
    const lastTrustFlagWins = ["--no-approve", "--approve"];
    expect(withDieSystemPrompt(lastTrustFlagWins, { cwd, agentDir })).toBe(lastTrustFlagWins);

    const explicitlyDenied: string[] = [];
    expect(
      withDieSystemPrompt(explicitlyDenied, {
        cwd,
        agentDir,
        projectTrusted: false,
      }),
    ).toEqual(["--system-prompt", dieSystemPrompt()]);
    await rm(join(cwd, ".die", "SYSTEM.md"));
    await writeFile(join(agentDir, "SYSTEM.md"), "GLOBAL");
    const globalArgs: string[] = [];
    expect(withDieSystemPrompt(globalArgs, { cwd, agentDir })).toBe(globalArgs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
