#!/usr/bin/env python3
"""Real controlling-PTY offline smoke; all state and process groups owned here."""
import os,sys,tempfile,pathlib,subprocess,pty,fcntl,termios,struct,select,time,json,signal,hashlib
binary=str(pathlib.Path(sys.argv[1]).resolve());out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
root=pathlib.Path(tempfile.mkdtemp(prefix='godie-pty-'));home=root/'home';home.mkdir();work=root/'work';work.mkdir();tmp=root/'tmp';tmp.mkdir()
env={'HOME':str(home),'TMPDIR':str(tmp),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TERM':'xterm-256color','COLORTERM':'truecolor','HERDR_ENV':'0','DIE_CODING_AGENT_DIR':str(root/'agent'),'DIE_CODING_AGENT_SESSION_DIR':str(root/'sessions'),'GODIE_STATE_DIR':str(root/'state')}
master,slave=pty.openpty();before=termios.tcgetattr(slave)
def size(w,h):fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',h,w,0,0))
size(120,40)
def child():os.setsid();fcntl.ioctl(slave,termios.TIOCSCTTY,0)
p=subprocess.Popen([binary,'--offline','--no-session','--provider','openai','--model','gpt-4o'],stdin=slave,stdout=slave,stderr=slave,cwd=work,env=env,preexec_fn=child,close_fds=True)
frames=[];allbytes=bytearray()
def read_for(seconds,label):
 end=time.monotonic()+seconds;data=bytearray()
 while time.monotonic()<end:
  if select.select([master],[],[],max(0,min(.1,end-time.monotonic())))[0]:
   try:b=os.read(master,65536)
   except OSError:break
   if not b:break
   data.extend(b);allbytes.extend(b)
  if p.poll() is not None:break
 (out/(label+'.ansi')).write_bytes(data);frames.append({'label':label,'bytes':len(data),'alive':p.poll() is None})
try:
 read_for(4,'startup');os.write(master,b'/status\r');read_for(1,'status');os.write(master,b'\x1b');os.write(master,b'draft-CJK-\xe7\x95\x8c');read_for(.5,'draft')
 size(20,4);os.kill(p.pid,signal.SIGWINCH);read_for(.5,'short');size(120,40);os.kill(p.pid,signal.SIGWINCH);read_for(.5,'restored')
 os.write(master,b'\x03');read_for(.4,'interrupt');os.write(master,b'\x03');read_for(1,'exit')
 if p.poll() is None:
  p.terminate()
  try:p.wait(timeout=12)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
finally:
 after=termios.tcgetattr(slave);(out/'full.ansi').write_bytes(allbytes)
 report={'binary':binary,'sha256':hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),'root':str(root),'pid':p.pid,'exitCode':p.returncode,'frames':frames,'terminalLflagRestored':before[3]==after[3],'stdoutBytes':len(allbytes),'containsPanic':b'panic:' in allbytes}
 (out/'manifest.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));os.close(master);os.close(slave)
