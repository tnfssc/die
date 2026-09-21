import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 64 * 1024;

export type WorkspaceRequest = { kind: "inherit" } | { kind: "worktree"; baseRef?: string; branch?: string };

export interface WorkspaceSummary {
  kind: "inherit" | "worktree";
  path: string;
  worktreePath?: string;
  sourcePath?: string;
  baseRef?: string;
  baseOid?: string;
  branch?: string;
  setupTaskId?: string;
  setupStatus?: "running" | "completed" | "failed";
  setupConfigDigest?: string;
  preparationStatus?: "preparing" | "ready" | "failed";
  preparationError?: string;
}

export interface WorktreeSource {
  sourcePath: string;
  commonGitDir: string;
  baseRef: string;
  baseOid: string;
  setup?: WorktreeSetup;
}
export interface WorktreeSetup {
  command: string;
  async: boolean;
  configDigest: string;
}

async function git(cwd: string, args: string[], signal?: AbortSignal, allowFailure = false) {
  try {
    return await execFileAsync("git", args, {
      cwd,
      signal,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT,
      windowsHide: true,
    });
  } catch (error) {
    if (allowFailure && error && typeof error === "object" && "code" in error && error.code === 1) return undefined;
    const detail = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
    throw new Error(`Git workspace preparation failed${detail ? `: ${detail}` : ""}`, { cause: error });
  }
}

async function mustGit(cwd: string, args: string[], signal?: AbortSignal) {
  const result = await git(cwd, args, signal);
  if (!result) throw new Error("Git workspace preparation failed");
  return result;
}

/** Strip JSONC comments and trailing commas without changing string contents. */
export function parseJsonc(text: string): unknown {
  let output = "",
    string = false,
    escaped = false,
    lineComment = false,
    blockComment = false;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index),
      next = text[index + 1];
    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        output += char;
      } else output += " ";
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        output += "  ";
        index++;
        blockComment = false;
      } else output += char === "\n" || char === "\r" ? char : " ";
      continue;
    }
    if (string) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') {
      string = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index++;
      lineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      index++;
      blockComment = true;
      continue;
    }
    output += char;
  }
  let cleaned = "",
    quoted = false,
    slash = false;
  for (let index = 0; index < output.length; index++) {
    const char = output.charAt(index);
    if (quoted) {
      cleaned += char;
      if (slash) slash = false;
      else if (char === "\\") slash = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      cleaned += char;
      continue;
    }
    if (char === ",") {
      let look = index + 1;
      while (look < output.length && /\s/.test(output.charAt(look))) look++;
      if (output[look] === "}" || output[look] === "]") continue;
    }
    cleaned += char;
  }
  return JSON.parse(cleaned);
}

export async function readWorktreeSetup(sourcePath: string): Promise<WorktreeSetup | undefined> {
  let text: string;
  try {
    const configPath = join(sourcePath, "t3.json");
    if ((await stat(configPath)).size > 1_000_000) throw new Error("t3.json is too large");
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error("Unable to read t3.json", { cause: error });
  }
  let value: unknown;
  try {
    value = parseJsonc(text);
  } catch (error) {
    throw new Error("Invalid t3.json", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid t3.json");
  const scripts = (value as { scripts?: unknown }).scripts;
  if (scripts === undefined) return undefined;
  if (!Array.isArray(scripts) || scripts.length > 50) throw new Error("Invalid t3.json scripts");
  let selected: WorktreeSetup | undefined;
  for (const script of scripts) {
    if (!script || typeof script !== "object" || Array.isArray(script)) throw new Error("Invalid t3.json script");
    const item = script as Record<string, unknown>;
    if (typeof item.name !== "string" || !item.name.trim() || typeof item.command !== "string" || !item.command.trim())
      throw new Error("Invalid t3.json script");
    if (item.async !== undefined && typeof item.async !== "boolean") throw new Error("Invalid t3.json script async");
    if (item.runOnWorktreeCreate !== undefined && typeof item.runOnWorktreeCreate !== "boolean")
      throw new Error("Invalid t3.json setup flag");
    if (item.runOnWorktreeCreate === true && !selected)
      selected = { command: item.command, async: item.async !== false, configDigest: "" };
  }
  if (selected) selected.configDigest = createHash("sha256").update(text).digest("hex");
  return selected;
}

/** Resolve the source commit exactly once; reuse this object for every item in a batch. */
export async function resolveWorktreeSource(
  cwd: string,
  baseRef = "HEAD",
  signal?: AbortSignal,
): Promise<WorktreeSource> {
  validateRefInput(baseRef, "base ref");
  const top = (await mustGit(cwd, ["rev-parse", "--show-toplevel"], signal)).stdout.trim();
  const sourcePath = resolve(top);
  const commonRaw = (await mustGit(sourcePath, ["rev-parse", "--git-common-dir"], signal)).stdout.trim();
  const commonGitDir = resolve(sourcePath, commonRaw);
  const baseOid = (
    await mustGit(sourcePath, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`], signal)
  ).stdout.trim();
  if (!/^[0-9a-fA-F]{40,64}$/.test(baseOid)) throw new Error("Git returned an invalid base object ID");
  return { sourcePath, commonGitDir, baseRef, baseOid, setup: await readWorktreeSetup(sourcePath) };
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent"
  );
}

function validateRefInput(value: string, label: string): void {
  if (!value || value.startsWith("-") || /[\x00-\x20\x7f]/.test(value)) throw new Error(`Invalid worktree ${label}`);
}

export async function createWorktree(
  source: WorktreeSource,
  options: {
    taskId: string;
    title?: string;
    branch?: string;
    root?: string;
    signal?: AbortSignal;
    onPlanned?: (workspace: WorkspaceSummary) => void;
  },
): Promise<WorkspaceSummary> {
  const id = options.taskId;
  if (!/^task_[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid workspace task ID");
  const branch =
    options.branch ?? `die/${slug(options.title ?? basename(source.sourcePath))}-${id.replace(/^task_/, "")}`;
  validateRefInput(branch, "branch");
  await git(source.sourcePath, ["check-ref-format", "--branch", branch], options.signal);
  const exists = await git(
    source.sourcePath,
    ["show-ref", "--verify", "--quiet", "--", `refs/heads/${branch}`],
    options.signal,
    true,
  );
  if (exists !== undefined) throw new Error(`Worktree branch already exists: ${branch}`);
  const identity = createHash("sha256").update(source.commonGitDir).digest("hex").slice(0, 12);
  const root = resolve(options.root ?? process.env.DIE_WORKTREE_ROOT ?? join(homedir(), ".die", "worktrees"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await realpath(root)) !== root) throw new Error("Managed worktree root must not be a symlink");
  const path = join(root, `${slug(basename(source.sourcePath))}-${identity}-${id}`);
  if (!isAbsolute(path) || dirname(path) !== root) throw new Error("Invalid managed worktree path");
  try {
    await lstat(path);
    throw new Error(`Managed worktree path already exists: ${path}`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  options.onPlanned?.({
    kind: "worktree",
    path,
    worktreePath: path,
    sourcePath: source.sourcePath,
    baseRef: source.baseRef,
    baseOid: source.baseOid,
    branch,
    preparationStatus: "preparing",
  });
  await git(
    source.sourcePath,
    ["worktree", "add", "--no-track", "-b", branch, "--", path, source.baseOid],
    options.signal,
  );
  return {
    kind: "worktree",
    path,
    worktreePath: path,
    sourcePath: source.sourcePath,
    baseRef: source.baseRef,
    baseOid: source.baseOid,
    branch,
    preparationStatus: "ready",
  };
}

export function setupShell(command: string): { command: string; args: string[] } {
  if (process.platform === "win32")
    return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", command] };
  return { command: process.env.SHELL ?? "/bin/sh", args: ["-lc", command] };
}
