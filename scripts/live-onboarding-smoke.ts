import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const binary = resolve(process.env.DIE_LIVE_SMOKE_BINARY ?? join(root, "dist/die"));
function requireExecutable(name: string): string {
  const path = Bun.which(name);
  if (!path) throw new Error(`${name} is required for the compiled Live onboarding smoke`);
  return path;
}

const tmux = requireExecutable("tmux");
if (!(await Bun.file(binary).exists())) throw new Error(`${binary} is missing; build the compiled CLI first`);

const directory = await mkdtemp(join(tmpdir(), "die-live-onboarding-"));
const executable = join(directory, "die");
const home = join(directory, "home");
const fakeBin = join(directory, "bin");
const invocationLog = join(directory, "audio-invocations");
const socket = `die-live-onboarding-${process.pid}`;
const target = "smoke:0.0";
const fakeKey = "fake-compiled-onboarding-key-12345";

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function run(args: string[], allowFailure = false): string {
  const result = Bun.spawnSync([tmux, "-L", socket, ...args], { stdout: "pipe", stderr: "pipe" });
  if (!allowFailure && result.exitCode !== 0) {
    throw new Error(`tmux ${args[0]} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function pane(): string {
  return run(["capture-pane", "-p", "-t", target, "-S", "-200"]);
}

async function waitFor(text: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  let rendered = "";
  while (Date.now() < deadline) {
    rendered = pane();
    if (rendered.includes(text)) return rendered;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${JSON.stringify(text)}. Last frame:\n${rendered}`);
}

function key(value: string): void {
  run(["send-keys", "-t", target, value]);
}

try {
  await copyFile(binary, executable);
  await chmod(executable, 0o700);
  await mkdir(join(home, ".die"), { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(join(home, ".die", "live.env"), `GEMINI_API_KEY=${fakeKey}\n`, { mode: 0o600 });

  // Discovery may find these names, but setup must never execute either device command.
  for (const name of ["live-audio", "live-audio-linux", "rec", "play"]) {
    const tool = join(fakeBin, name);
    await writeFile(tool, `#!/bin/sh\nprintf '%s\\n' ${name} >> ${quote(invocationLog)}\nexit 97\n`, {
      mode: 0o700,
    });
    await chmod(tool, 0o700);
  }

  const command = [
    `cd ${quote(directory)} && exec /usr/bin/env -i`,
    `HOME=${quote(home)}`,
    `PATH=${quote(fakeBin)}`,
    "TERM=xterm-256color",
    "PI_OFFLINE=1",
    quote(executable),
    "--offline --no-session --no-approve",
  ].join(" ");
  run(["new-session", "-d", "-s", "smoke", "-x", "120", "-y", "40", command]);
  await waitFor("No models available");

  run(["send-keys", "-t", target, "-l", "/live"]);
  key("Enter");
  let frame = await waitFor("Import ~/.die/live.env");
  assert.ok(frame.includes("Google API key required"));
  assert.ok(!frame.includes("Audio tools:"));
  assert.ok(!frame.includes(fakeKey));

  // Selecting Import is the explicit action. Do not select Start voice.
  key("Enter");
  frame = await waitFor("Start voice");
  assert.ok(!frame.includes("Test paid connection"));
  assert.ok(!frame.includes(fakeKey));

  // Dismiss setup, then inspect argument suggestions without executing voice.
  key("Escape");
  await Bun.sleep(100);
  run(["send-keys", "-t", target, "-l", "/live s"]);
  frame = await waitFor("speaker-check");
  for (const action of ["start", "stop", "setup", "status", "speaker-check"])
    assert.match(frame, new RegExp("(?:→ |    )" + action + "(?:\\n|$)"));
  assert.ok(!frame.includes("live-lab"));

  const authPath = join(home, ".die", "agent", "auth.json");
  const auth = JSON.parse(await readFile(authPath, "utf8"));
  assert.deepEqual(auth, { google: { type: "api_key", key: fakeKey } });
  assert.equal((await stat(authPath)).mode & 0o777, 0o600);
  const sourcePath = join(home, ".die", "live.env");
  assert.equal((await stat(sourcePath)).mode & 0o777, 0o600);
  assert.equal(await readFile(sourcePath, "utf8"), `GEMINI_API_KEY=${fakeKey}\n`);
  assert.equal(await Bun.file(invocationLog).exists(), false, "setup unexpectedly executed an audio command");

  // Never select Start voice: devices and provider stay outside this offline smoke.
  console.log("compiled Live onboarding smoke passed (offline fake credential import; no paid test or audio command)");
} finally {
  run(["kill-server"], true);
  await rm(directory, { recursive: true, force: true });
}
