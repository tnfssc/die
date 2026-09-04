import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const SOCKET = process.env.DIE_TUI_SOCKET ?? "die-harness";
const root = resolve(import.meta.dir, "..");
const stateDir = join(root, ".die-harness");
const artifactsDir = join(root, "artifacts", "tui");
const timeoutSeconds = Number(process.env.DIE_TUI_TIMEOUT_SECONDS ?? 60 * 60);
const [command = "help", session = "test", ...args] = Bun.argv.slice(2);

type State = { artifactDir: string; transcript: string; expiresAt?: string };

function usage(): never {
  console.log(`die TUI harness

Usage:
  bun run tui start [session] [die args...]  Start die in a detached PTY
  bun run tui frame [session] [file]         Capture the visible frame
  bun run tui history [session] [file]       Capture full pane history
  bun run tui send <session> <text>          Submit a steering message
  bun run tui followup <session> <text>      Queue a follow-up message
  bun run tui key <session> <tmux-key>       Send a key (e.g. Escape, C-c)
  bun run tui record <session> [seconds] [interval-ms]
  bun run tui list
  bun run tui stop [session]

LLM sessions default to openai-codex/gpt-5.6-luna.
The session named "demo" is automatically killed after 60 minutes.`);
  process.exit(["help", "--help", "-h"].includes(command) ? 0 : 1);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function tmux(tmuxArgs: string[], allowFailure = false): Promise<string> {
  const proc = Bun.spawn(["tmux", "-L", SOCKET, "-f", join(root, "scripts", "tmux.conf"), ...tmuxArgs], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && !allowFailure) throw new Error(stderr.trim() || `tmux exited with ${code}`);
  return stdout;
}

async function saveState(name: string, state: State): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, `${name}.json`), JSON.stringify(state, null, 2));
}

async function loadState(name: string): Promise<State | undefined> {
  try {
    return JSON.parse(await readFile(join(stateDir, `${name}.json`), "utf8")) as State;
  } catch {
    return undefined;
  }
}

async function capture(name: string, history: boolean, ansi: boolean): Promise<string> {
  return tmux(["capture-pane", "-p", ...(ansi ? ["-e"] : []), "-t", `${name}:0.0`, ...(history ? ["-S", "-"] : [])]);
}

async function writeOrPrint(content: string, output?: string): Promise<void> {
  if (!output) {
    process.stdout.write(content);
    return;
  }
  const path = resolve(output);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
  console.log(path);
}

switch (command) {
  case "help":
  case "--help":
  case "-h":
    usage();
    break;

  case "start": {
    if (!/^[A-Za-z0-9_-]+$/.test(session)) throw new Error("Session names may contain letters, numbers, _ and - only");
    await tmux(["has-session", "-t", session], true).then(async () => {
      const existing = await tmux(["list-sessions", "-F", "#{session_name}"], true);
      if (existing.split("\n").includes(session)) throw new Error(`Session already exists: ${session}`);
    });

    const stamp = new Date().toISOString().replaceAll(":", "-");
    const artifactDir = join(artifactsDir, `${session}-${stamp}`);
    const transcript = join(artifactDir, "transcript.ansi");
    await mkdir(artifactDir, { recursive: true });

    const dieArgs = ["--provider", "openai-codex", "--model", "gpt-5.6-luna", ...args];
    const launch = [join(root, "dist", "die"), ...dieArgs].map(shellQuote).join(" ");
    await tmux(["new-session", "-d", "-s", session, "-x", "120", "-y", "40", launch]);
    let expiresAt: string | undefined;
    if (session === "demo") {
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("Invalid demo timeout");
      const watchdog = `sleep ${Math.ceil(timeoutSeconds)}; tmux -L ${SOCKET} kill-session -t ${shellQuote(session)} 2>/dev/null || true`;
      await tmux(["new-window", "-d", "-t", session, "-n", "__die_timeout", watchdog]);
      expiresAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString();
    }
    await tmux(["pipe-pane", "-o", "-t", `${session}:0.0`, `cat >> ${shellQuote(transcript)}`]);
    await saveState(session, { artifactDir, transcript, expiresAt });
    await Bun.sleep(750);
    await writeFile(join(artifactDir, "initial.txt"), await capture(session, false, false));
    console.log(`Started ${session}${expiresAt ? `\nAuto-kill: ${expiresAt}` : ""}\nArtifacts: ${artifactDir}`);
    break;
  }

  case "frame":
    await writeOrPrint(await capture(session, false, false), args[0]);
    break;

  case "history":
    await writeOrPrint(await capture(session, true, false), args[0]);
    break;

  case "send":
  case "followup": {
    const text = args.join(" ");
    if (!text) throw new Error(`${command} requires message text`);
    await tmux(["send-keys", "-t", `${session}:0.0`, "-l", text]);
    await tmux(["send-keys", "-t", `${session}:0.0`, command === "send" ? "Enter" : "M-Enter"]);
    break;
  }

  case "key":
    if (!args[0]) throw new Error("key requires a tmux key name");
    await tmux(["send-keys", "-t", `${session}:0.0`, args[0]]);
    break;

  case "record": {
    const seconds = Number(args[0] ?? 10);
    const interval = Number(args[1] ?? 250);
    if (!(seconds > 0) || !(interval >= 50)) throw new Error("Invalid duration or interval");
    const state = await loadState(session);
    const output = join(state?.artifactDir ?? artifactsDir, `frames-${Date.now()}`);
    await mkdir(output, { recursive: true });
    const count = Math.ceil((seconds * 1000) / interval);
    for (let index = 0; index < count; index++) {
      const frame = await capture(session, false, true);
      await writeFile(join(output, `${String(index).padStart(5, "0")}.ansi`), frame);
      await Bun.sleep(interval);
    }
    console.log(`Recorded ${count} frames to ${output}`);
    break;
  }

  case "list":
    process.stdout.write(await tmux(["list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{session_created_string}"], true));
    break;

  case "stop": {
    const state = await loadState(session);
    if (state) await writeFile(join(state.artifactDir, "final.txt"), await capture(session, false, false));
    await tmux(["kill-session", "-t", session]);
    console.log(`Stopped ${session}${state ? `; transcript: ${basename(state.transcript)}` : ""}`);
    break;
  }

  default:
    usage();
}
