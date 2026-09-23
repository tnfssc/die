#!/usr/bin/env python3
"""Pipe saturation must fail the helper, never silently drop frames or truncate JSON."""
import subprocess
import sys
import threading

p = subprocess.Popen([sys.argv[1]], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.PIPE)
errors = []
def flood():
    try:
        for _ in range(20000):
            p.stdin.write(b'{}\n')
            p.stdin.flush()
    except BrokenPipeError:
        pass
    except Exception as exc:
        errors.append(exc)
t = threading.Thread(target=flood, daemon=True)
t.start()
try:
    assert p.wait(timeout=5) == 74, 'stdout backpressure did not terminate the helper'
    assert b'backpressure' in p.stderr.read()
    assert not errors, errors
    print('backpressure OK')
finally:
    if p.poll() is None: p.kill()
    p.wait()
