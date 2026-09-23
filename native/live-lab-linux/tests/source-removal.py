#!/usr/bin/env python3
"""Unplug a test-only virtual source; stop must not wait on blocked Pulse I/O."""
import json
import os
import select
import subprocess
import sys
import time

binary, mic, sink, module = sys.argv[1:]
p = subprocess.Popen([binary, '--source', mic, '--sink', sink], stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
pending = b''
def read(kind, timeout=4):
    global pending
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if b'\n' not in pending:
            if not select.select([p.stdout], [], [], max(0, deadline-time.monotonic()))[0]: break
            pending += os.read(p.stdout.fileno(), 65536)
            if not pending: break
            continue
        line, pending = pending.split(b'\n', 1)
        obj = json.loads(line)
        if obj['type'] == kind: return obj
    raise AssertionError('missing ' + kind)
def cmd(kind):
    p.stdin.write(json.dumps({'type': kind})+'\n'); p.stdin.flush()
try:
    read('hello'); cmd('start'); read('ready')
    subprocess.run(['pactl', 'unload-module', module], check=True)
    # Pulse/PipeWire may move a stream to another source rather than report a
    # device failure. In either case stop must not wait on the removed device.
    start = time.monotonic()
    cmd('stop'); read('stopped', 2)
    assert time.monotonic() - start < 2
    print('source-removal stop OK (server may have rerouted source)')
finally:
    p.stdin.close()
    try: p.wait(timeout=3)
    except subprocess.TimeoutExpired: p.kill(); p.wait()
    assert p.returncode == 0, p.stderr.read()
