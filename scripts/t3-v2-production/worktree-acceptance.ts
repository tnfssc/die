#!/usr/bin/env bun
/**
 * Live acceptance for structured worktree subagents.
 *
 * This deliberately drives a relocated packaged Die through both the real T3
 * PiAdapter/native delegation path and the local JobService path.  The only
 * model is a private deterministic OpenAI-compatible loopback server.
 *
 * Required (provided by the release orchestrator):
 *   T3_WORKTREE_ACCEPT=1
 *   T3_WORKTREE_DIE_BINARY=/exact/new/dist/path
 *   T3_WORKTREE_EXPECT_SHA256=<sha256>
 * Optional: T3_V2_CANDIDATE=/exact/canonical/t3/checkout (defaults to the pinned checkout)
 *   T3_V2_EXPECT_CHECKOUT_HEAD=<git oid>
 * Optional: T3_V2_CHROMIUM, T3_WORKTREE_KEEP_TEMP=1, T3_WORKTREE_PROOF=...
 */
import { Database } from "bun:sqlite";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sourcePin from "../../web/t3-source.json";

const ROOT = resolve(import.meta.dirname, "../..");
const DIE = resolve(process.env.T3_WORKTREE_DIE_BINARY || join(ROOT, "dist/die-worktree-production"));
const EXPECT_SHA = process.env.T3_WORKTREE_EXPECT_SHA256 || "";
const CANDIDATE = resolve(process.env.T3_V2_CANDIDATE || join(ROOT, ".cache/die-t3code-" + sourcePin.revision));
const EXPECT_HEAD = process.env.T3_V2_EXPECT_CHECKOUT_HEAD || "";
const KEEP = process.env.T3_WORKTREE_KEEP_TEMP === "1";
const PROOF = resolve(process.env.T3_WORKTREE_PROOF || join(ROOT, "artifacts/worktree-acceptance/proof.json"));
const FULL_CONTEXT = "WORKTREE_FULL_USER_CONTEXT_4f7319";
const M = {
  native: "WORKTREE_NATIVE_SUITE",
  nativeArmed: "WORKTREE_NATIVE_ARMED",
  local: "WORKTREE_LOCAL_SUITE",
  localDone: "WORKTREE_LOCAL_PARENT_DONE",
  childA: "WORKTREE_CHILD_A",
  childB: "WORKTREE_CHILD_B",
  childFinal: "WORKTREE_CHILD_FINAL",
  failure: "WORKTREE_SETUP_FAILURE",
  slow: "WORKTREE_SETUP_SLOW_CANCEL",
  background: "WORKTREE_SETUP_BACKGROUND",
  backgroundArmed: "WORKTREE_BACKGROUND_ARMED",
  missing: "WORKTREE_SETUP_MISSING",
  missingArmed: "WORKTREE_MISSING_ARMED",
  childBackground: "WORKTREE_CHILD_BACKGROUND",
  childMissing: "WORKTREE_CHILD_MISSING",
} as const;
const NATIVE_SETUP_SCRIPT = {
  id: "native-acceptance-setup",
  name: "Native acceptance setup",
  command: "./native-setup.sh",
  icon: "configure",
  runOnWorktreeCreate: true,
  async: false,
};

type Owned = { pid: number; startTime: string };
type RequestEvidence = {
  at: string;
  route: string;
  cwd?: string;
  branch?: string;
  fullContext?: boolean;
  setupDoneAtProbe?: boolean;
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error("worktree acceptance: " + message);
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await Bun.file(path).bytes())
    .digest("hex");
const redact = (text: string) =>
  text
    .replace(/((?:authorization|token|api[_-]?key|secret)\s*[:=]\s*)[^\s"']+/gi, "$1<redacted>")
    .replace(/^(Token:).*$/gim, "$1 <redacted>");
async function waitFor<T>(fn: () => T | Promise<T>, timeout: number, label: string): Promise<T> {
  const end = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await sleep(150);
  }
  throw new Error("worktree acceptance: timeout waiting for " + label + (last ? ": " + last : ""));
}
async function command(argv: string[], cwd: string, env?: Record<string, string>) {
  const child = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...process.env, ...env } : process.env,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  check(code === 0, argv.join(" ") + " failed (" + code + "): " + redact(stderr));
  return stdout.trim();
}
async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}
async function requestBody(request: IncomingMessage) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text);
}
function sse(response: ServerResponse, delta: Record<string, unknown>, finish: string) {
  const base = {
    id: "worktree-acceptance",
    object: "chat.completion.chunk",
    created: 1,
    model: "worktree-deterministic",
  };
  const chunks = [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
  ];
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  response.end(chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") + "data: [DONE]\n\n");
}
function tool(response: ServerResponse, id: string, code: string) {
  sse(
    response,
    {
      role: "assistant",
      tool_calls: [
        { index: 0, id, type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } },
      ],
    },
    "tool_calls",
  );
}
async function proc(pid: number): Promise<Owned | undefined> {
  try {
    const line = await Bun.file(`/proc/${pid}/stat`).text();
    const fields = line
      .slice(line.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/);
    return { pid, startTime: fields[19] || "" };
  } catch {
    return undefined;
  }
}
async function descendants(roots: number[]) {
  const todo = [...roots],
    seen = new Set<number>(),
    found: Owned[] = [];
  while (todo.length) {
    const pid = todo.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const identity = await proc(pid);
    if (!identity) continue;
    found.push(identity);
    try {
      const children = await Bun.file(`/proc/${pid}/task/${pid}/children`).text();
      todo.push(...children.trim().split(/\s+/).filter(Boolean).map(Number));
    } catch {}
  }
  return found;
}
async function assertGone(items: Owned[]) {
  const live: number[] = [];
  for (const item of items) if ((await proc(item.pid))?.startTime === item.startTime) live.push(item.pid);
  check(live.length === 0, "owned processes survived teardown: " + live.join(","));
}
async function stopGroup(child?: ChildProcess) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([once(child, "exit"), sleep(6_000)]).catch(() => {});
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await once(child, "exit").catch(() => {});
  }
}
async function playwrightRoot() {
  if (process.env.T3_V2_PLAYWRIGHT_ROOT) return resolve(process.env.T3_V2_PLAYWRIGHT_ROOT);
  const pnpm = join(CANDIDATE, "node_modules/.pnpm");
  const name = (await readdir(pnpm))
    .filter((x) => x.startsWith("playwright-core@"))
    .sort()
    .reverse()[0];
  check(name, "candidate dependencies absent; harness never installs");
  return join(pnpm, name, "node_modules/playwright-core");
}
async function chromiumPath() {
  if (process.env.T3_V2_CHROMIUM) return resolve(process.env.T3_V2_CHROMIUM);
  const cache = join(process.env.HOME || "", ".cache/ms-playwright");
  for (const name of (await readdir(cache).catch(() => []))
    .filter((x) => x.startsWith("chromium-"))
    .sort()
    .reverse()) {
    const path = join(cache, name, "chrome-linux64/chrome");
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error("worktree acceptance: Chromium unavailable; set T3_V2_CHROMIUM");
}
async function worktrees(repo: string) {
  const text = await command(["git", "worktree", "list", "--porcelain"], repo);
  return text
    .split(/\n\n+/)
    .filter(Boolean)
    .map(
      (part) =>
        Object.fromEntries(
          part.split("\n").map((line) => {
            const at = line.indexOf(" ");
            return at < 0 ? [line, true] : [line.slice(0, at), line.slice(at + 1)];
          }),
        ) as Record<string, string | true>,
    );
}

// No state or process allocation before identity gates.
check(process.env.T3_WORKTREE_ACCEPT === "1", "set T3_WORKTREE_ACCEPT=1 after selecting the coordinated candidate");
check(EXPECT_SHA, "T3_WORKTREE_EXPECT_SHA256 is required");
check(EXPECT_HEAD, "T3_V2_EXPECT_CHECKOUT_HEAD is required");
await Promise.all([access(DIE), access(join(CANDIDATE, ".git"))]);
const [dieReal, candidateReal, actualSha, actualHead] = await Promise.all([
  realpath(DIE),
  realpath(CANDIDATE),
  sha256(DIE),
  command(["git", "rev-parse", "HEAD"], CANDIDATE),
]);
check(actualSha === EXPECT_SHA, `binary hash mismatch: expected ${EXPECT_SHA}, got ${actualSha}`);
check(actualHead === EXPECT_HEAD, `candidate head mismatch: expected ${EXPECT_HEAD}, got ${actualHead}`);

const temp = await mkdtemp(join(tmpdir(), "die-worktree-acceptance-"));
await chmod(temp, 0o700);
const home = join(temp, "home"),
  baseDir = join(home, ".die/web"),
  agentDir = join(temp, "agent");
const runtimeBin = join(temp, "bin"),
  runtimeDie = join(runtimeBin, "die"),
  repo = join(temp, "repo");
const audit = join(temp, "setup-audit"),
  localSessions = join(temp, "local-sessions"),
  runtimeTmp = join(temp, "tmp");
await Promise.all([
  mkdir(join(baseDir, "userdata"), { recursive: true }),
  mkdir(join(agentDir, "extensions"), { recursive: true }),
  mkdir(runtimeBin),
  mkdir(repo),
  mkdir(audit),
  mkdir(localSessions),
  mkdir(runtimeTmp),
  mkdir(resolve(PROOF, ".."), { recursive: true }),
]);
await copyFile(dieReal, runtimeDie);
await chmod(runtimeDie, 0o700);
for (const name of ["sh", "bash", "git", "sleep", "printf", "env", "uname", "mkdir", "cat", "pwd"]) {
  const path = Bun.which(name);
  if (path) await symlink(path, join(runtimeBin, name));
}
for (const name of ["node", "bun", "npm", "pnpm", "npx"])
  check(!Bun.which(name, { PATH: runtimeBin }), "external JS runtime leaked: " + name);
check((await sha256(runtimeDie)) === actualSha, "relocated binary digest changed");
await command(["git", "init", "--quiet", "--initial-branch=main"], repo);
await command(["git", "config", "user.email", "acceptance@example.invalid"], repo);
await command(["git", "config", "user.name", "Worktree Acceptance"], repo);
await writeFile(join(repo, "tracked.txt"), "PINNED_BASE\n");
await writeFile(
  join(repo, "native-setup.sh"),
  `#!/bin/sh
set -eu
branch=$(git branch --show-current)
printf '%s\n' "$PWD" > .native-setup-cwd
printf '%s\n' "native|$branch|$PWD" >> "$WORKTREE_ACCEPTANCE_AUDIT/attempts"
case "$branch" in
  *setup-fail*) printf 'EXPECTED_SETUP_FAILURE\n' >&2; exit 23 ;;
  *setup-slow*) printf 'slow-start\n' > .worktree-slow-start; sleep 120 ;;
  *setup-background*) sleep 4; printf 'background-done\n' > .worktree-background-done ;;
esac
printf 'native-done\n' > .native-setup-done
`,
);
await writeFile(
  join(repo, "local-setup.sh"),
  `#!/bin/sh
set -eu
branch=$(git branch --show-current)
printf '%s\n' "$PWD" > .local-setup-cwd
printf '%s\n' "local|$branch|$PWD" >> "$WORKTREE_ACCEPTANCE_AUDIT/attempts"
printf 'local-done\n' > .local-setup-done
`,
);
await Promise.all([chmod(join(repo, "native-setup.sh"), 0o700), chmod(join(repo, "local-setup.sh"), 0o700)]);
// This declaration is intentionally local-only. Native web setup is seeded as
// a real private settings action and must never auto-import it.
await writeFile(
  join(repo, "t3.json"),
  JSON.stringify(
    { scripts: [{ name: "local-only setup", command: "./local-setup.sh", runOnWorktreeCreate: true, async: false }] },
    null,
    2,
  ),
);
await command(["git", "add", "tracked.txt", "native-setup.sh", "local-setup.sh", "t3.json"], repo);
await command(["git", "commit", "--quiet", "-m", "fixture"], repo);
const baseOid = await command(["git", "rev-parse", "HEAD"], repo);
// These parent-only changes must never appear in a child worktree.
await writeFile(join(repo, "tracked.txt"), "DIRTY_PARENT_ONLY\n");
await writeFile(join(repo, "untracked.secret"), "MUST_NOT_COPY\n");

const requests: RequestEvidence[] = [];
let unexpected = 0;
const model = createServer(async (request, response) => {
  try {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ data: [] }));
    }
    const payload = await requestBody(request),
      all = JSON.stringify(payload),
      last = JSON.stringify(payload.messages?.at(-1) || {});
    const record = (route: string, extra: Partial<RequestEvidence> = {}) =>
      requests.push({ at: new Date().toISOString(), route, ...extra });
    const childRoute = last.includes(M.childBackground)
      ? "child-background"
      : last.includes(M.childMissing)
        ? "child-missing"
        : last.includes(M.childA)
          ? "child-a"
          : last.includes(M.childB)
            ? "child-b"
            : undefined;
    if (childRoute && !all.includes("worktree_child_probe")) {
      record(childRoute + "-probe", { fullContext: all.includes(FULL_CONTEXT) });
      return tool(
        response,
        "worktree_child_probe",
        `const cwd=process.cwd(); const p=await Bun.spawn(["git","branch","--show-current"],{cwd,stdout:"pipe"}); const branch=(await new Response(p.stdout).text()).trim(); await p.exited; const read=async(n)=>await Bun.file(cwd+"/"+n).text().catch(()=>""); console.log(JSON.stringify({marker:"WORKTREE_PROBE",cwd,branch,tracked:await read("tracked.txt"),dirtyCopied:await Bun.file(cwd+"/untracked.secret").exists(),nativeSetupCwd:(await read(".native-setup-cwd")).trim(),nativeSetupDone:(await read(".native-setup-done")).trim(),localSetupCwd:(await read(".local-setup-cwd")).trim(),localSetupDone:(await read(".local-setup-done")).trim(),backgroundDone:(await read(".worktree-background-done")).trim()}));`,
      );
    }
    const childHistoryRoute = all.includes(M.childBackground)
      ? "child-background"
      : all.includes(M.childMissing)
        ? "child-missing"
        : all.includes(M.childA)
          ? "child-a"
          : all.includes(M.childB)
            ? "child-b"
            : undefined;
    if (childHistoryRoute && all.includes("worktree_child_probe")) {
      record(childHistoryRoute + "-final", {
        fullContext: all.includes(FULL_CONTEXT),
        setupDoneAtProbe: last.includes("native-done") || last.includes("local-done"),
      });
      return sse(response, { role: "assistant", content: M.childFinal + " " + childHistoryRoute }, "stop");
    }
    if (last.includes(M.native) && !all.includes("worktree_native_launch")) {
      record("native-launch");
      return tool(
        response,
        "worktree_native_launch",
        `const batch=await subagent({type:"fast",prompts:Array.from({length:5},(_,i)=>(i===1?"WORKTREE_CHILD_B":"WORKTREE_CHILD_A")+" WORKTREE_FULL_USER_CONTEXT_4f7319 task "+i),title:"Independent work",workspace:{kind:"worktree"}}); let branchRejected=false; try { await subagent({prompts:["x","y"],workspace:{kind:"worktree",branch:"accept/forbidden-batch"}}); } catch(e) { branchRejected=true; } const failure=await subagent({type:"fast",prompt:"WORKTREE_SETUP_FAILURE",workspace:{kind:"worktree",baseRef:"${baseOid}",branch:"accept/setup-fail"}}); const slow=await subagent({type:"fast",prompt:"WORKTREE_SETUP_SLOW_CANCEL",workspace:{kind:"worktree",baseRef:"${baseOid}",branch:"accept/setup-slow"}}); await new Promise(r=>setTimeout(r,700)); const stopped=await jobs.stop(slow.id); const launched=[...batch,failure,slow]; if(!branchRejected||launched.some(x=>x.workspace?.kind!=="worktree"||x.workspace.baseRef!=="${baseOid}"||x.background!==true||x.deliveryMode!=="native-async")||!stopped.cancellationRequested) throw new Error("native launch result contract mismatch"); console.log(JSON.stringify({marker:"WORKTREE_NATIVE_LAUNCHED",batch,failure,slow,stopped,branchRejected}));`,
      );
    }
    if (all.includes("worktree_native_launch") && !all.includes(M.nativeArmed)) {
      record("native-armed");
      return sse(response, { role: "assistant", content: M.nativeArmed }, "stop");
    }
    if (last.includes(M.background) && !all.includes("worktree_background_launch")) {
      record("background-launch");
      return tool(
        response,
        "worktree_background_launch",
        `const task=await subagent({type:"fast",prompt:"WORKTREE_CHILD_BACKGROUND WORKTREE_FULL_USER_CONTEXT_4f7319",workspace:{kind:"worktree",baseRef:"${baseOid}",branch:"accept/setup-background"}}); if(task.workspace?.kind!=="worktree"||task.workspace.baseRef!=="${baseOid}"||task.workspace.branch!=="accept/setup-background"||task.background!==true) throw new Error("background launch result contract mismatch"); console.log(JSON.stringify({marker:"WORKTREE_BACKGROUND_LAUNCHED",task}));`,
      );
    }
    if (all.includes("worktree_background_launch") && !all.includes(M.backgroundArmed)) {
      record("background-armed");
      return sse(response, { role: "assistant", content: M.backgroundArmed }, "stop");
    }
    if (last.includes(M.missing) && !all.includes("worktree_missing_launch")) {
      record("missing-launch");
      return tool(
        response,
        "worktree_missing_launch",
        `const task=await subagent({type:"fast",prompt:"WORKTREE_CHILD_MISSING WORKTREE_FULL_USER_CONTEXT_4f7319",workspace:{kind:"worktree",baseRef:"${baseOid}",branch:"accept/setup-missing"}}); if(task.workspace?.kind!=="worktree"||task.workspace.baseRef!=="${baseOid}"||task.workspace.branch!=="accept/setup-missing"||task.background!==true) throw new Error("missing launch result contract mismatch"); console.log(JSON.stringify({marker:"WORKTREE_MISSING_LAUNCHED",task}));`,
      );
    }
    if (all.includes("worktree_missing_launch") && !all.includes(M.missingArmed)) {
      record("missing-armed");
      return sse(response, { role: "assistant", content: M.missingArmed }, "stop");
    }
    if (
      last.includes("asynchronous task completed") ||
      /reached (?:a )?terminal state/i.test(last) ||
      /setup.*fail|cancel/i.test(last)
    ) {
      record("native-parent-result");
      return sse(
        response,
        { role: "assistant", content: "WORKTREE_PARENT_RESULT_RECEIVED " + last.slice(0, 400) },
        "stop",
      );
    }
    if (last.includes(M.local) && !all.includes("worktree_local_launch")) {
      record("local-launch");
      return tool(
        response,
        "worktree_local_launch",
        `const batch=await subagent({type:"fast",prompts:Array.from({length:5},(_,i)=>(i===1?"${M.childB}":"${M.childA}")+" ${FULL_CONTEXT} task "+i),title:"Independent local work",waitSeconds:60,workspace:{kind:"worktree"}}); if(batch.length!==5||batch.some(x=>x.status!=="completed"||x.workspace?.baseOid!=="${baseOid}")) throw new Error("local batch contract mismatch"); let branchRejected=false; try { await subagent({prompts:["x","y"],workspace:{kind:"worktree",branch:"accept/local-forbidden"}}); } catch(e) { branchRejected=true; } console.log(JSON.stringify({marker:"WORKTREE_LOCAL_RESULTS",batch,branchRejected}));`,
      );
    }
    if (all.includes("worktree_local_launch")) {
      record("local-done");
      return sse(response, { role: "assistant", content: M.localDone }, "stop");
    }
    // Setup-failed/cancelled children should never reach the provider.
    if (last.includes(M.failure) || last.includes(M.slow)) {
      record("forbidden-child-start");
      return sse(response, { role: "assistant", content: "FORBIDDEN_CHILD_STARTED" }, "stop");
    }
    unexpected++;
    record("unexpected");
    return sse(response, { role: "assistant", content: "WORKTREE_UNEXPECTED_ROUTE" }, "stop");
  } catch (error) {
    response.writeHead(500);
    response.end(redact(String(error)));
  }
});
const modelPort = await listen(model);
await writeFile(
  join(agentDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        deterministic: {
          baseUrl: `http://127.0.0.1:${modelPort}/v1`,
          api: "openai-completions",
          apiKey: "isolated-fixture",
          models: [
            { id: "worktree-deterministic", name: "Worktree deterministic", contextWindow: 64000, maxTokens: 4000 },
          ],
        },
      },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
await writeFile(
  join(agentDir, "settings.json"),
  JSON.stringify({
    defaultProvider: "deterministic",
    defaultModel: "worktree-deterministic",
    defaultThinkingLevel: "off",
  }),
  { mode: 0o600 },
);
await writeFile(
  join(baseDir, "userdata/settings.json"),
  JSON.stringify(
    {
      providerInstances: {
        pi: {
          driver: "pi",
          enabled: true,
          environment: [
            { name: "PI_CODING_AGENT_DIR", value: agentDir, sensitive: false },
            { name: "DIE_CODING_AGENT_DIR", value: agentDir, sensitive: false },
          ],
          config: { binaryPath: runtimeDie, customModels: ["deterministic/worktree-deterministic"] },
        },
      },
      defaultProjectScripts: [NATIVE_SETUP_SCRIPT],
      defaultModelSelection: { instanceId: "pi", model: "deterministic/worktree-deterministic" },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

let backend: ChildProcess | undefined, local: ReturnType<typeof Bun.spawn> | undefined, browser: any, page: any;
let backendOutput = "",
  localOutput = "",
  captured: Owned[] = [];
const evidence: any = {
  passed: false,
  startedAt: new Date().toISOString(),
  temp,
  executable: dieReal,
  sha256: actualSha,
  candidate: candidateReal,
  candidateHead: actualHead,
  baseOid,
};
try {
  const reserve = createServer(),
    port = await listen(reserve);
  reserve.close();
  await once(reserve, "close");
  const origin = `http://127.0.0.1:${port}`;
  const launchBackend = (bootstrap = false) => {
    const child = spawn(
      runtimeDie,
      [
        "web",
        "--no-browser",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--base-dir",
        baseDir,
        ...(bootstrap ? ["--auto-bootstrap-project-from-cwd"] : []),
      ],
      {
        cwd: repo,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: runtimeBin,
          HOME: home,
          TMPDIR: runtimeTmp,
          XDG_CONFIG_HOME: join(temp, "xdg-config"),
          XDG_CACHE_HOME: join(temp, "xdg-cache"),
          XDG_DATA_HOME: join(temp, "xdg-data"),
          PI_CODING_AGENT_DIR: agentDir,
          DIE_CODING_AGENT_DIR: agentDir,
          DIE_WEB_DIE_BINARY: runtimeDie,
          WORKTREE_ACCEPTANCE_AUDIT: audit,
          NO_PROXY: "127.0.0.1,localhost",
          no_proxy: "127.0.0.1,localhost",
        },
      },
    );
    child.stdout?.on("data", (x) => (backendOutput += x));
    child.stderr?.on("data", (x) => (backendOutput += x));
    return child;
  };
  const waitForBackend = async () => {
    console.log("worktree fixture: waiting for backend", origin);
    await waitFor(
      async () => (await fetch(origin, { signal: AbortSignal.timeout(2_000) }).catch(() => undefined))?.ok,
      30_000,
      "backend",
    );
  };
  backend = launchBackend(true);
  await waitForBackend();
  console.log("worktree fixture: backend ready, loading browser");
  const pw = await import(join(await playwrightRoot(), "index.mjs"));
  console.log("worktree fixture: browser module loaded");
  browser = await pw.chromium.launch({ executablePath: await chromiumPath(), headless: true, args: ["--no-sandbox"] });
  console.log("worktree fixture: browser launched");
  page = await browser.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-chat-provider-model-picker="true"]').count()))
    await page.getByText("New thread", { exact: true }).first().click();
  const send = async (text: string) => {
    const editor = page.locator('[contenteditable="true"]').last();
    await editor.click();
    await editor.fill(text);
    await page.locator('[data-chat-composer-surface="true"] button[type="submit"]').last().click();
  };
  const replaceNativeSetup = async (script: typeof NATIVE_SETUP_SCRIPT | undefined) => {
    const owned = backend?.pid ? await descendants([backend.pid]) : [];
    await stopGroup(backend);
    await assertGone(owned);
    const path = join(baseDir, "userdata/settings.json");
    const settings = JSON.parse(await readFile(path, "utf8"));
    settings.defaultProjectScripts = script ? [script] : [];
    await writeFile(path, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
    backend = launchBackend();
    await waitForBackend();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[contenteditable="true"]').last().waitFor({ state: "visible", timeout: 20_000 });
  };
  const newThread = async () => {
    await page.getByText("New thread", { exact: true }).first().click();
    await page.locator('[contenteditable="true"]').last().waitFor({ state: "visible" });
  };
  const awaitParentSettled = async (before: number, label: string) => {
    await waitFor(
      async () => requests.filter((x) => x.route === "native-parent-result").length > before,
      60_000,
      label + " parent completion delivery",
    );
    const editor = page.locator('[contenteditable="true"]').last();
    await editor.fill("WORKTREE_NO_MAIN_STALL_PROBE");
    await waitFor(
      async () => {
        const submit = page.getByRole("button", { name: "Submit message", exact: true }).last();
        return (await submit.count()) > 0 && !(await submit.isDisabled());
      },
      15_000,
      label + " main thread not stalled",
    );
    await editor.fill("");
  };

  // Seed the real private server settings before startup. The checked-in t3.json
  // remains a distinct local-only command and is never used by native setup.
  const seededSettings = await readFile(join(baseDir, "userdata/settings.json"), "utf8");
  check(seededSettings.includes("./native-setup.sh"), "native project action was not persisted");
  check(!seededSettings.includes("./local-setup.sh"), "web auto-imported the t3.json local action");

  let parentResults = requests.filter((x) => x.route === "native-parent-result").length;
  console.log("worktree fixture: launching five native children");
  await send(M.native + " " + FULL_CONTEXT);
  await waitFor(() => requests.some((x) => x.route === "native-armed"), 35_000, "native parent armed");
  await waitFor(
    async () => requests.filter((x) => x.route === "child-a-final" || x.route === "child-b-final").length >= 5,
    60_000,
    "five native children",
  );
  await waitFor(
    () => {
      const db = new Database(join(baseDir, "userdata/statev2.sqlite"), { readonly: true });
      try {
        const rows = db.query("SELECT payload_json FROM orchestration_v2_projection_subagents").all() as Array<{
          payload_json: string;
        }>;
        return rows.filter((row) => JSON.parse(row.payload_json).status !== "running").length >= 7;
      } finally {
        db.close();
      }
    },
    60_000,
    "all native children terminal before backend restart",
  );
  await awaitParentSettled(parentResults, "awaited setup");
  await waitFor(async () => (await worktrees(repo)).length >= 8, 30_000, "retained native worktrees");

  await replaceNativeSetup({ ...NATIVE_SETUP_SCRIPT, async: true });
  await newThread();
  parentResults = requests.filter((x) => x.route === "native-parent-result").length;
  await send(M.background + " " + FULL_CONTEXT);
  await waitFor(() => requests.some((x) => x.route === "background-armed"), 35_000, "background parent armed");
  await waitFor(
    async () => requests.some((x) => x.route === "child-background-final"),
    60_000,
    "background setup child",
  );
  await awaitParentSettled(parentResults, "background setup");
  const backgroundPreparedTree = (await worktrees(repo)).find((tree) =>
    String(tree.branch).endsWith("accept/setup-background"),
  );
  check(backgroundPreparedTree, "background worktree missing before restart");
  await waitFor(
    () => Bun.file(join(String(backgroundPreparedTree.worktree), ".worktree-background-done")).exists(),
    15000,
    "background setup completion before backend restart",
  );

  await replaceNativeSetup(undefined);
  parentResults = requests.filter((x) => x.route === "native-parent-result").length;
  await send(M.missing + " " + FULL_CONTEXT);
  await waitFor(() => requests.some((x) => x.route === "missing-armed"), 35_000, "missing parent armed");
  await waitFor(async () => requests.some((x) => x.route === "child-missing-final"), 60_000, "missing setup child");
  await awaitParentSettled(parentResults, "missing setup");

  // Prove local preparation needs no running native backend.
  captured = await descendants([backend!.pid!]);
  await stopGroup(backend);
  await assertGone(captured);
  backend = undefined;
  console.log("worktree fixture: backend stopped before CLI batch");

  // A second real Die process exercises local JobService; it has no T3 URL and
  // therefore cannot accidentally route local preparation through the backend.
  local = Bun.spawn(
    [
      runtimeDie,
      "--approve",
      "--mode",
      "json",
      "-p",
      "--provider",
      "deterministic",
      "--model",
      "worktree-deterministic",
      "--session-dir",
      localSessions,
      M.local + " " + FULL_CONTEXT,
    ],
    {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: runtimeBin,
        HOME: home,
        TMPDIR: runtimeTmp,
        XDG_CONFIG_HOME: join(temp, "xdg-config-local"),
        XDG_CACHE_HOME: join(temp, "xdg-cache-local"),
        XDG_DATA_HOME: join(temp, "xdg-data-local"),
        PI_CODING_AGENT_DIR: agentDir,
        DIE_CODING_AGENT_DIR: agentDir,
        WORKTREE_ACCEPTANCE_AUDIT: audit,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
      },
    },
  );
  const localStderr = local.stderr,
    localStdout = local.stdout;
  check(localStderr instanceof ReadableStream, "local stderr pipe unavailable");
  check(localStdout instanceof ReadableStream, "local stdout pipe unavailable");
  const localErr = new Response(localStderr).text(),
    localOut = new Response(localStdout).text();
  const [out, err, code] = await Promise.all([localOut, localErr, local.exited]);
  localOutput = out + "\n" + err;
  check(code === 0, "local Die failed (" + code + "): " + redact(localOutput));
  check(localOutput.includes(M.localDone), "local parent did not settle deterministically");

  const listed = await worktrees(repo),
    childTrees = listed.filter((x) => x.worktree !== repo);
  check(childTrees.length === 14, "expected retained native+local worktrees, got " + childTrees.length);
  const paths = childTrees.map((x) => String(x.worktree));
  check(new Set(paths).size === paths.length, "worktree paths collided");
  const branches = childTrees.map((x) => String(x.branch || ""));
  check(new Set(branches.filter(Boolean)).size === branches.filter(Boolean).length, "worktree branches collided");
  for (const path of paths.filter((p) => !p.includes("setup-fail") && !p.includes("setup-slow"))) {
    check(
      (await readFile(join(path, "tracked.txt"), "utf8")) === "PINNED_BASE\n",
      "dirty tracked parent copied to " + path,
    );
    check(!(await Bun.file(join(path, "untracked.secret")).exists()), "untracked parent file copied to " + path);
  }
  check(
    requests.filter((x) => x.route.endsWith("probe")).every((x) => x.fullContext),
    "child did not receive full parent user context",
  );
  check(
    requests.filter((x) => x.route.endsWith("-final")).length >= 12,
    "native/local child transcripts did not all complete",
  );
  const backgroundRequest = requests.find((x) => x.route === "child-background-final");
  const missingRequest = requests.find((x) => x.route === "child-missing-final");
  check(backgroundRequest?.setupDoneAtProbe === false, "background setup blocked provider start");
  check(missingRequest?.setupDoneAtProbe === false, "missing setup unexpectedly ran a project action");
  const backgroundTree = childTrees.find((x) => String(x.branch).endsWith("accept/setup-background"));
  const missingTree = childTrees.find((x) => String(x.branch).endsWith("accept/setup-missing"));
  check(backgroundTree && typeof backgroundTree.worktree === "string", "background worktree missing");
  check(missingTree && typeof missingTree.worktree === "string", "missing-script worktree missing");
  await waitFor(
    () => Bun.file(join(String(backgroundTree.worktree), ".worktree-background-done")).exists(),
    15_000,
    "background setup completion",
  );
  check(
    !(await Bun.file(join(String(missingTree.worktree), ".native-setup-cwd")).exists()),
    "missing-script fixture ran configured native setup",
  );
  check(!requests.some((x) => x.route === "forbidden-child-start"), "failed/cancelled setup released provider");
  check(!backendOutput.includes("ENAMETOOLONG"), "terminal log identity exceeded filesystem limits");
  check(unexpected === 0, "deterministic model saw unexpected routes: " + unexpected);
  const allAttempts = (await readFile(join(audit, "attempts"), "utf8")).trim().split("\n").filter(Boolean);
  // Auto-bootstrap may run the configured project action in the source checkout;
  // worktree at-most-once evidence is intentionally scoped to child branches.
  const parentSetupAttempts = allAttempts.filter((line) => line.split("|")[1] === "main");
  const attempts = allAttempts.filter((line) => line.split("|")[1] !== "main");
  const counts = Object.fromEntries(
    [...new Set(attempts)].map((line) => [line, attempts.filter((x) => x === line).length]),
  );
  check(
    Object.values(counts).every((n) => n === 1),
    "setup attempt repeated: " + JSON.stringify(counts),
  );
  check(attempts.length === 13, "unexpected setup attempt count: " + JSON.stringify(attempts));
  for (const attempt of attempts) {
    const [owner, branch, cwd] = attempt.split("|");
    check(owner === "native" || owner === "local", "unknown setup owner: " + attempt);
    const tree = childTrees.find((candidate) => String(candidate.branch) === "refs/heads/" + branch);
    check(tree && tree.worktree === cwd, "setup cwd did not match its worktree: " + attempt);
    const cwdReceipt = owner === "native" ? ".native-setup-cwd" : ".local-setup-cwd";
    check((await readFile(join(cwd, cwdReceipt), "utf8")).trim() === cwd, "setup cwd receipt mismatch: " + attempt);
  }
  check(
    requests
      .filter((x) => x.route === "child-a-final" || x.route === "child-b-final")
      .every((x) => x.setupDoneAtProbe === true),
    "awaited native/local setup did not finish before provider start",
  );
  const sessions = (await readdir(localSessions, { recursive: true })).filter((x) => String(x).endsWith(".jsonl"));
  check(sessions.length >= 6, "local parent/child transcripts missing");
  const dbPath = join(baseDir, "userdata/statev2.sqlite");
  const db = new Database(dbPath, { readonly: true });
  const rows = db.query("SELECT event_type, payload_json FROM orchestration_events ORDER BY sequence").all() as Array<{
    event_type: string;
    payload_json: string;
  }>;
  db.close();
  const lifecycle = rows.map((row) => ({ event: row.event_type, payload: JSON.parse(row.payload_json) }));
  check(
    lifecycle.some((x) => JSON.stringify(x).includes("failed")),
    "native setup failure absent from lifecycle",
  );
  check(
    lifecycle.some((x) => /cancel|stop/i.test(JSON.stringify(x))),
    "native cancellation absent from lifecycle",
  );
  Object.assign(evidence, {
    passed: true,
    completedAt: new Date().toISOString(),
    origin,
    requests,
    worktrees: childTrees,
    setupAttempts: attempts,
    parentSetupAttempts,
    localSessions: sessions.length,
    lifecycle,
    assertions: [
      "actual backend + PiAdapter + relocated Die",
      "native and local distinct worktrees from one pinned base",
      "CLI batch runs with native backend stopped and no T3 bridge environment",
      "real private server settings setup (never t3.json auto-import)",
      "awaited, background and missing-script setup semantics",
      "setup cwd and at-most-once attempts",
      "dirty parent state not copied",
      "failed/cancelled worktrees retained and provider not started",
      "batch explicit branch rejected",
      "child transcripts and parent result delivery",
      "private loopback model/backend and private HOME",
    ],
  });
  await writeFile(PROOF, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log("worktree acceptance: PASS sha256=" + actualSha + " proof=" + PROOF);
} catch (error) {
  evidence.error = redact(String(error));
  evidence.requests = requests;
  evidence.backendOutput = redact(backendOutput);
  evidence.localOutput = redact(localOutput);
  await writeFile(PROOF, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopGroup(backend);
  model.close();
  await once(model, "close").catch(() => {});
  if (captured.length) await assertGone(captured);
  if (!KEEP) await rm(temp, { recursive: true, force: true });
  else console.error("kept worktree acceptance state: " + temp);
}
