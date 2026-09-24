#!/usr/bin/env python3
"""Protocol smoke; optional virtual sink/source args for device isolation."""
import base64
import ctypes
import math
import threading
import json
import select
import subprocess
import sys
import time

p = subprocess.Popen([sys.argv[1], *sys.argv[2:]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
def read(kind, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not select.select([p.stdout], [], [], deadline - time.monotonic())[0]: break
        obj = json.loads(p.stdout.readline())
        if obj['type'] == 'error': raise AssertionError(obj)
        if obj['type'] == kind: return obj
        if obj['type'] == 'capture':
            assert kind != 'ready', 'capture preceded ready'
            assert len(base64.b64decode(obj['data'])) == 640
    raise AssertionError('missing '+kind)
def cmd(**kwargs):
    p.stdin.write(json.dumps(kwargs)+'\n'); p.stdin.flush()
try:
    assert read('hello')['protocol'] == 1
    if len(sys.argv) > 2:
        cmd(type='start'); read('ready')
        # Feed synthetic near-end audio to the isolated virtual microphone sink.
        lib = ctypes.CDLL('libpulse-simple.so.0')
        class Spec(ctypes.Structure):
            _fields_ = [('format', ctypes.c_int), ('rate', ctypes.c_uint32), ('channels', ctypes.c_uint8)]
        lib.pa_simple_new.restype = ctypes.c_void_p
        lib.pa_simple_new.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p, ctypes.POINTER(Spec), ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
        lib.pa_simple_write.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_int)]
        lib.pa_simple_free.argtypes = [ctypes.c_void_p]
        error = ctypes.c_int()
        mic_sink = sys.argv[sys.argv.index('--source') + 1].removesuffix('.monitor').encode()
        stream = lib.pa_simple_new(None, b'die-live-test', 1, mic_sink, b'synthetic near end', ctypes.byref(Spec(3, 16000, 1)), None, None, ctypes.byref(error))
        assert stream, error.value
        frame = bytes().join(int(8000*math.sin(2*math.pi*440*i/16000)).to_bytes(2, 'little', signed=True) for i in range(160))
        def inject():
            for _ in range(30):
                assert lib.pa_simple_write(stream, frame, len(frame), ctypes.byref(error)) == 0, error.value
            lib.pa_simple_free(stream)
        feeder = threading.Thread(target=inject); feeder.start()
        pcm = base64.b64encode(b'\x00\x20'*480).decode()
        cmd(type='play', generation=0, data=pcm)
        assert read('played')['queuedMs'] >= 0
        cmd(type='flush', generation=1)
        cmd(type='play', generation=1, data=pcm)
        read('played')
        # Drain reports must reach zero without a new play command.
        deadline = time.monotonic() + 3
        while True:
            assert time.monotonic() < deadline, "no playback drain report"
            if read('played')['queuedMs'] == 0: break
        assert any(any(base64.b64decode(read('capture')['data'])) for _ in range(100))
        feeder.join(timeout=4); assert not feeder.is_alive()
        cmd(type='stop'); read('stopped')
        cmd(type='start'); read('ready')
        cmd(type='stop'); read('stopped')
    print('protocol OK')
finally:
    p.stdin.close()
    try: p.wait(timeout=5)
    except subprocess.TimeoutExpired: p.kill(); p.wait()
    assert p.returncode == 0, p.stderr.read()
