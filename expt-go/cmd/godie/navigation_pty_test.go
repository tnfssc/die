package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"godie/internal/app"
)

func TestNavigationPTYHelper(t *testing.T) {
	if os.Getenv("GODIE_NAV_PTY_HELPER") != "1" {
		return
	}
	os.Args = []string{"godie", "--offline", "--provider", "openai", "--model", "gpt-4.1-mini"}
	if err := mainRun(); err != nil && !errors.Is(err, app.ErrQuit) {
		t.Fatal(err)
	}
}

func TestInteractiveNewAndResumePTY(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 is required for the controlling-PTY integration test")
	}
	root := t.TempDir()
	script := `import os,pty,fcntl,termios,struct,subprocess,pathlib,time,select,signal,json,sys,atexit
root=pathlib.Path(sys.argv[1]); state=root/'state'; work=root/'work'; work.mkdir()
env=dict(os.environ); env.update(GODIE_NAV_PTY_HELPER='1',GODIE_STATE_DIR=str(state),HOME=str(root/'home'),TERM='xterm-256color',HERDR_ENV='0'); pathlib.Path(env['HOME']).mkdir()
m,s=pty.openpty(); fcntl.ioctl(s,termios.TIOCSWINSZ,struct.pack('HHHH',35,120,0,0))
def child(): os.setsid(); fcntl.ioctl(s,termios.TIOCSCTTY,0)
p=subprocess.Popen([sys.argv[2],'-test.run=^TestNavigationPTYHelper$'],cwd=work,env=env,stdin=s,stdout=s,stderr=s,preexec_fn=child,close_fds=True)
def cleanup():
 if p.poll() is None:
  os.killpg(p.pid,signal.SIGKILL); p.wait(timeout=5)
 os.close(m); os.close(s)
atexit.register(cleanup)
out=bytearray()
def drain(sec):
 end=time.time()+sec
 while time.time()<end:
  if select.select([m],[],[],.1)[0]:
   try: out.extend(os.read(m,65536))
   except OSError: return

def files(): return list((state/'sessions').glob('*.jsonl')) if (state/'sessions').exists() else []
def waitn(n):
 for _ in range(80):
  drain(.1)
  if len(files())==n: return
 raise RuntimeError(('session count',n,[str(x) for x in files()]))
def locked(path):
 f=open(str(path)+'.lock','r+')
 try:
  fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); fcntl.flock(f,fcntl.LOCK_UN); return False
 except BlockingIOError: return True
 finally: f.close()
def waitactive(active,inactive):
 for _ in range(300):
  drain(.1)
  if locked(active) and not locked(inactive): return
 raise RuntimeError(('active lock',str(active),str(inactive)))
def waitrender(previous):
 for _ in range(300):
  drain(.1)
  if out.count("".encode()) > previous: return
 raise RuntimeError(('TUI not ready',previous,out.count("".encode()),len(out)))
drain(.5); waitn(1); waitrender(0); old=files()[0]; oldid=json.loads(old.read_text().splitlines()[0])['id']
renders=out.count("".encode()); os.write(m,b'/new\r'); waitn(2)
new=[x for x in files() if x != old][0]; newid=json.loads(new.read_text().splitlines()[0])['id']; waitactive(new,old); waitrender(renders)
renders=out.count("".encode()); os.write(m,('/resume '+oldid[:18]+'\r').encode()); waitactive(old,new); waitrender(renders)
# Synchronize with editor readiness, not the early OSC window-title event.
for _ in range(40):
 drain(.05)
 if not (termios.tcgetattr(s)[3] & termios.ICANON): break
drain(.3)
os.write(m,b'/session\r')
for _ in range(80):
 drain(.05)
 if oldid.encode() in out: break
os.write(m,b'\x03'); drain(.2); os.write(m,b'\x03'); drain(.5)
if p.poll() is None: os.killpg(p.pid,signal.SIGTERM); p.wait(timeout=5)
assert oldid != newid
assert len(files()) == 2
assert oldid.encode() in out, repr(bytes(out[-12000:]))
assert b'panic:' not in out
print(json.dumps({'old':oldid,'new':newid,'files':len(files()),'exit':p.returncode}))
`
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, python, "-c", script, root, os.Args[0])
	command.Env = os.Environ()
	command.Dir = filepath.Dir(root)
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("PTY navigation timed out: %s", output)
	}
	if err != nil {
		t.Fatalf("PTY navigation failed: %v\n%s", err, output)
	}
	t.Log(string(output))
}
