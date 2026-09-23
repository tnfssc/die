#!/usr/bin/env bun
/**
 * Launch production T3-v2 native integration acceptance.
 *
 * The candidate test joins the real production backend, a real Die executable,
 * and a stable loopback HTTP model fixture. This launcher only gives it an
 * isolated environment and checks its source. It never installs dependencies or
 * starts the user-facing server.
 */
import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import sourcePin from "../../web/t3-source.json";

const ROOT = resolve(import.meta.dir, "../..");
const CANDIDATE = resolve(process.env.T3_V2_CANDIDATE ?? join(ROOT, ".cache/die-t3code-" + sourcePin.revision));
const TEST_REL = "apps/server/src/orchestration-v2/NativeDieIntegration.production.test.ts";
const TEST = join(CANDIDATE, TEST_REL);
const VP = join(CANDIDATE, "node_modules/.bin/vp");
const requestedDie = process.env.T3_V2_DIE_BINARY ?? "";
const keep = process.env.T3_V2_KEEP_TEMP === "1";
const artifacts = resolve(
  process.env.T3_V2_NATIVE_ARTIFACTS ?? join(ROOT, "scripts/t3-v2-production/artifacts/native"),
);

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function sha256(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
async function command(argv: string[], cwd = ROOT) {
  const child = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  check(exitCode === 0, `command failed (${exitCode}): ${argv.join(" ")}\n${stderr}`);
  return stdout.trim();
}
function redact(text: string) {
  return text
    .replace(/(authorization["'\s:=]+bearer\s+)[^\s"']+/gi, "$1<redacted>")
    .replace(/((?:token|api[_-]?key|secret)["'\s:=]+)[^\s,"'}]+/gi, "$1<redacted>");
}

check(process.env.T3_V2_ACCEPT_CANDIDATE === "1", "set T3_V2_ACCEPT_CANDIDATE=1 after reviewing the candidate");
check(isAbsolute(requestedDie), "T3_V2_DIE_BINARY must be an absolute path to the reviewed executable");
await Promise.all([access(CANDIDATE), access(TEST), access(VP), access(requestedDie)]);
const die = await realpath(requestedDie);
check((await lstat(die)).isFile(), "T3_V2_DIE_BINARY must resolve to a regular file");
const [head, expectedHead, dieSha, expectedSha, testSource] = await Promise.all([
  command(["git", "rev-parse", "HEAD"], CANDIDATE),
  Promise.resolve(process.env.T3_V2_EXPECT_CHECKOUT_HEAD ?? ""),
  sha256(die),
  Promise.resolve(process.env.T3_V2_EXPECT_BINARY_SHA256 ?? ""),
  readFile(TEST, "utf8"),
]);
check(expectedHead.length === 40 && head === expectedHead, "candidate HEAD does not match T3_V2_EXPECT_CHECKOUT_HEAD");
check(
  expectedSha.length === 64 && dieSha === expectedSha.toLowerCase(),
  "Die SHA-256 does not match T3_V2_EXPECT_BINARY_SHA256",
);
check(
  !/experiments\/t3-v2|\.runtime\//.test(testSource),
  "production native test must not import/use experiment runtime paths",
);
check(
  testSource.includes("createServer") && testSource.includes("127.0.0.1"),
  "candidate test must own a loopback deterministic HTTP model fixture",
);
check(testSource.includes("die_task_launch"), "candidate test does not exercise the native production MCP contract");
check(
  !testSource.includes("McpSessionRegistry.testkit") && testSource.includes("mcpSessionRegistryLayer: registryLayer"),
  "candidate test must use the shared real MCP registry, never the fake MCP testkit registry",
);

const tempParent = resolve(process.env.T3_V2_TEMP_PARENT ?? tmpdir());
await mkdir(tempParent, { recursive: true });
const temp = await mkdtemp(join(tempParent, "die-t3-v2-native-"));
const home = join(temp, "home");
await Bun.write(join(temp, ".keep"), "");
let child: ReturnType<typeof Bun.spawn> | undefined;
let stdout = "";
let stderr = "";
let exitCode = -1;
try {
  child = Bun.spawn([VP, "test", "run", TEST_REL, "--testTimeout=120000"], {
    cwd: CANDIDATE,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      XDG_CONFIG_HOME: join(temp, "xdg-config"),
      XDG_CACHE_HOME: join(temp, "xdg-cache"),
      XDG_DATA_HOME: join(temp, "xdg-data"),
      T3_V2_NATIVE_ACCEPTANCE: "1",
      T3_V2_NATIVE_TEMP: temp,
      T3_V2_DIE_BINARY: die,
      DIE_WEB_DIE_BINARY: die,
      TMPDIR: temp,
      T3_V2_EXPECT_BINARY_SHA256: dieSha,
      // The test is required to bind all listeners explicitly to loopback.
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    },
  });
  [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout as ReadableStream<Uint8Array>).text(),
    new Response(child.stderr as ReadableStream<Uint8Array>).text(),
    child.exited,
  ]);
  check(exitCode === 0, `native candidate integration failed (${exitCode})\n${redact(stdout)}\n${redact(stderr)}`);
  const evidencePath = join(temp, "native-evidence.json");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  check(evidence?.version === 1, "candidate test did not emit native evidence v1");
  check(evidence?.die?.sha256 === dieSha, "evidence executable digest mismatch");
  check(evidence?.network?.loopbackOnly === true, "test did not prove loopback-only listeners");
  check(evidence?.teardown?.allOwnedPidsReaped === true, "test did not prove exact owned-PID teardown");
  check(evidence?.sessions?.dieChildSessionFiles === 0, "Die created forbidden child session files");
  check(evidence?.delivery?.foregroundResultAcks === 0, "async-only launch produced a foreground result ACK");
  check(evidence?.delivery?.singleCompletion === 1, "completion was not delivered exactly once");
  check(
    evidence?.behaviors?.liveObserve === true && evidence?.behaviors?.nestedChildren === 1,
    "live observation/nested child evidence missing",
  );
  check(
    evidence?.behaviors?.cancellationSubtree === true && evidence?.behaviors?.siblingUnaffected === true,
    "cancellation topology evidence missing",
  );
  check(evidence?.behaviors?.parentHandoffSurvived === true, "parent handoff survival evidence missing");
  check(evidence?.behaviors?.uniqueNativeCredential === true, "unique native credential/session evidence missing");
  check(
    evidence?.restart?.tested === true &&
      evidence?.restart?.sameKey === true &&
      evidence?.restart?.duplicateChildren === 0,
    "restart replay was not proven",
  );
  await rm(artifacts, { recursive: true, force: true });
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    join(artifacts, "proof.json"),
    `${JSON.stringify(
      {
        acceptedAt: new Date().toISOString(),
        candidate: CANDIDATE,
        candidateHead: head,
        test: TEST_REL,
        die: { path: die, sha256: dieSha },
        evidence,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(artifacts, "test.stdout.log"), redact(stdout));
  await writeFile(join(artifacts, "test.stderr.log"), redact(stderr));
  console.log(`native T3-v2 acceptance passed; proof: ${join(artifacts, "proof.json")}`);
} finally {
  // Normally the test owns and reaps every child. Only terminate the exact test
  // runner PID if execution escaped before its awaited exit; never scan/kill by name.
  if (child && exitCode === -1) {
    try {
      child.kill("SIGTERM");
    } catch {}
    await Promise.race([child.exited, Bun.sleep(2_000)]).catch(() => undefined);
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  if (!keep) await rm(temp, { recursive: true, force: true });
  else console.error(`kept native acceptance state: ${temp}`);
}
