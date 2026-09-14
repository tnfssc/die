#!/usr/bin/env python3
"""Real-terminal acceptance probe for Die's compact tool/task conversation UI.

Runs a compiled binary in an isolated tmux PTY against a loopback-only scripted
OpenAI-completions endpoint.  It writes screen/request evidence under the chosen
artifact prefix and never needs credentials or Internet access.
"""
from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

ANSI_RE = re.compile(r"(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\))")


def chunk(delta: dict, finish=None) -> dict:
    return {"id":"ui-cleanup-fixture", "object":"chat.completion.chunk",
            "created":1700000000, "model":"fixture-model",
            "choices":[{"index":0,"delta":delta,"finish_reason":finish}]}


def sse_for(n: int) -> bytes:
    calls = {
        1: ("success_call", 'console.log("SUCCESS_OUTPUT")'),
        2: ("error_call", 'throw new Error("EXPECTED_BOOM")'),
        3: ("long_call", 'console.log("L".repeat(6000))'),
        5: ("jobs_call", '''const a = await shell("sleep 0.20; exit 0", { waitSeconds: 0 });
const b = await shell("sleep 0.21; exit 7", { waitSeconds: 0 });
const c = await shell("sleep 0.22; exit 0", { waitSeconds: 0 });
await handoff("TASKS_WAITING_MARKER");'''),
    }
    if n in calls:
        call_id, code = calls[n]
        events = [chunk({"role":"assistant", "tool_calls":[{"index":0,"id":call_id,
            "type":"function","function":{"name":"execute","arguments":json.dumps({"code":code})}}]}),
                  chunk({}, "tool_calls")]
        if n == 2:
            events.insert(0, chunk({"content":"DIRECT_PROSE_MARKER"}))
    elif n == 4:
        events = [chunk({"role":"assistant"}),
                  chunk({"reasoning_content":"THINK_FIRST_MARKER"}),
                  chunk({"content":"FINAL_FIRST_MARKER"}), chunk({}, "stop")]
    elif n == 6:
        events = [chunk({"role":"assistant"}),
                  chunk({"reasoning_content":"THINK_BATCH_MARKER"}),
                  chunk({"content":"FINAL_BATCH_MARKER"}), chunk({}, "stop")]
    else:
        events = [chunk({"role":"assistant", "content":"UNEXPECTED_REQUEST_MARKER"}), chunk({}, "stop")]
    return ("".join("data: "+json.dumps(e,separators=(",",":"))+"\n\n" for e in events)+"data: [DONE]\n\n").encode()


class Fixture:
    def __init__(self):
        self.records: list[dict] = []
        self.lock = threading.Lock()
        fixture = self
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, fmt, *args):
                return
            def do_POST(self):
                try:
                    length = int(self.headers.get("content-length", "0"))
                    if length > 4_000_000:
                        self.send_error(413); return
                    raw = self.rfile.read(length)
                    body = json.loads(raw)
                except Exception:
                    self.send_error(400); return
                with fixture.lock:
                    n = len(fixture.records) + 1
                    roles = [m.get("role", "?") for m in body.get("messages", []) if isinstance(m, dict)]
                    fixture.records.append({"request":n, "path":self.path, "request_bytes":length,
                                            "message_roles":roles, "response_status":200})
                payload = sse_for(n)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Connection", "close")
                self.end_headers(); self.wfile.write(payload)
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
    @property
    def port(self): return self.server.server_address[1]
    def start(self): self.thread.start()
    def stop(self): self.server.shutdown(); self.server.server_close(); self.thread.join(2)


def run(cmd: list[str], *, timeout=10, check=True, env=None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, check=check, env=env)


def strip_ansi(s: str) -> str:
    return ANSI_RE.sub("", s).replace("\r", "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", default="dist/die", help="compiled die binary to exercise")
    ap.add_argument("--artifact-prefix", default="artifacts/ui-cleanup-final")
    ap.add_argument("--timeout", type=float, default=35.0)
    args = ap.parse_args()
    root = Path(__file__).resolve().parent.parent
    binary = Path(args.binary)
    if not binary.is_absolute(): binary = (root / binary).resolve()
    if not binary.is_file(): ap.error(f"binary not found: {binary}")
    if not shutil.which("tmux"): ap.error("tmux is required")
    prefix = Path(args.artifact_prefix)
    if not prefix.is_absolute(): prefix = root / prefix
    prefix.parent.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    home = prefix.parent / ("ui-cleanup-work-" + token)
    agent_dir, tmpdir = home / ".die" / "agent", home / "tmp"
    agent_dir.mkdir(parents=True); tmpdir.mkdir()
    fixture = Fixture(); fixture.start()
    models = {"providers":{"fixture":{"baseUrl":f"http://127.0.0.1:{fixture.port}/v1",
        "api":"openai-completions","apiKey":"fixture",
        "models":[{"id":"fixture-model","name":"fixture","reasoning":True,
                   "contextWindow":32000,"maxTokens":2000}]}}}
    (agent_dir / "models.json").write_text(json.dumps(models), encoding="utf-8")
    tmux_conf = home / "tmux.conf"
    tmux_conf.write_text("set -g extended-keys on\nset -g extended-keys-format csi-u\nset -g history-limit 20000\n", encoding="utf-8")
    session = "probe"
    tmux = ["tmux", "-S", str(home / "tmux.sock")]
    env = os.environ.copy(); env.update({"HOME":str(home), "DIE_CODING_AGENT_DIR":str(agent_dir),
        "TMPDIR":str(tmpdir), "PI_OFFLINE":"1", "NO_COLOR":"0", "TERM":"xterm-256color"})
    launch = [str(binary), "--no-session", "--no-approve", "--offline", "--provider", "fixture",
              "--model", "fixture-model", "--thinking", "medium", "FIRST_USER_MARKER"]
    command = "env " + " ".join(shlex.quote(k+"="+env[k]) for k in
        ["HOME","DIE_CODING_AGENT_DIR","TMPDIR","PI_OFFLINE","NO_COLOR","TERM"]) + " " + " ".join(map(shlex.quote, launch))
    plain = ansi = ""; assertions: dict[str, object] = {}; error = None
    deadline = time.monotonic() + args.timeout
    def capture(esc=False, history=True):
        cmd = tmux + ["capture-pane", "-p"]
        if esc: cmd.append("-e")
        if history: cmd += ["-S", "-"]
        cmd += ["-t", session]
        return run(cmd, timeout=3).stdout
    def wait_for(marker: str):
        while time.monotonic() < deadline:
            try:
                text = capture(history=False)
                if marker in strip_ansi(text): return
            except subprocess.CalledProcessError:
                pass
            time.sleep(.08)
        raise TimeoutError(f"timed out waiting for {marker}")
    try:
        run(tmux+["-f", str(tmux_conf), "new-session","-d","-s",session,"-x","120","-y","36","-c",str(home),command], env=env)
        wait_for("FINAL_FIRST_MARKER")
        run(tmux+["send-keys","-t",session,"-l","SECOND_USER_MARKER"], timeout=3)
        run(tmux+["send-keys","-t",session,"Enter"], timeout=3)
        wait_for("FINAL_BATCH_MARKER")
        time.sleep(.5)
        plain, ansi = capture(False), capture(True)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        try: plain, ansi = capture(False), capture(True)
        except Exception: pass
    finally:
        try: run(tmux+["kill-server"], timeout=3, check=False)
        except Exception: pass
        fixture.stop()
        shutil.rmtree(home, ignore_errors=True)
    clean = strip_ansi(plain)
    lines = [x.rstrip() for x in clean.splitlines()]
    def has(pattern): return re.search(pattern, clean, re.MULTILINE) is not None
    assertions["six_bounded_requests"] = len(fixture.records) == 6
    assertions["success_row"] = has(r'^\s*✓ executed · console\.log\("SUCCESS_OUTPUT"\)\s*$')
    assertions["error_row"] = has(r'^\s*✗ execute failed · throw new Error\("EXPECTED_BOOM"\)\s*$')
    assertions["long_row_truncated_only"] = has(r'^\s*✓ executed · truncated · console\.log\("L"\.repeat\(6000\)\)\s*$')
    assertions["no_output_file_count"] = not has(r'(?i)(output file|output artifact|\d+ output)')
    assertions["handoff_row"] = has(r'^\s*✓ executed · const a = await shell') and not has(r'^\s*✓ executed · \d+ background')
    batch_re = r'^\s*✓ (task_[A-Za-z0-9_-]+) executed, ✗ (task_[A-Za-z0-9_-]+) failed, ✓ (task_[A-Za-z0-9_-]+) executed\s*$'
    assertions["ordered_task_batch"] = has(batch_re)
    def spacing(think, prose, preceding_pattern):
        ti = next((i for i,x in enumerate(lines) if think in x), -1)
        pi = next((i for i,x in enumerate(lines) if prose in x), -1)
        if ti < 1 or pi < 0: return False
        before = ti - 1
        no_gap_thinking = bool(re.search(preceding_pattern, lines[before]))
        exactly_one_blank = pi == ti + 2 and lines[ti+1].strip() == ""
        return no_gap_thinking and exactly_one_blank
    direct = next((i for i,x in enumerate(lines) if "DIRECT_PROSE_MARKER" in x), -1)
    assertions["direct_prose_spacing"] = direct >= 2 and lines[direct-1].strip() == "" and '✓ executed · console.log("SUCCESS_OUTPUT")' in lines[direct-2]
    assertions["first_spacing"] = spacing("THINK_FIRST_MARKER", "FINAL_FIRST_MARKER", r"✓ executed · truncated")
    assertions["batch_spacing"] = spacing("THINK_BATCH_MARKER", "FINAL_BATCH_MARKER", r"✓ task_.*executed, ✗ task_.*failed, ✓ task_.*executed")
    assertions["markers_present"] = all(x in clean for x in ["THINK_FIRST_MARKER","FINAL_FIRST_MARKER","THINK_BATCH_MARKER","FINAL_BATCH_MARKER"])
    assertions["no_unexpected_request"] = "UNEXPECTED_REQUEST_MARKER" not in clean
    assertions["ansi_evidence"] = chr(27) + "[" in ansi
    (Path(str(prefix)+"-plain.txt")).write_text(plain, encoding="utf-8")
    (Path(str(prefix)+"-ansi.txt")).write_text(ansi, encoding="utf-8")
    (Path(str(prefix)+"-requests.json")).write_text(json.dumps(fixture.records, indent=2)+"\n", encoding="utf-8")
    report = {"binary":str(binary), "error":error, "request_count":len(fixture.records),
              "assertions":assertions, "passed":error is None and all(assertions.values())}
    (Path(str(prefix)+"-report.json")).write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
