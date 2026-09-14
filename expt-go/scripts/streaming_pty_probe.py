#!/usr/bin/env python3
"""Actual original/candidate interactive initial-prompt+streaming+draft comparison."""
import pathlib,sys,tempfile,subprocess,os,json,shutil,hashlib,time,threading,http.server,pty,fcntl,termios,struct,select,signal
original=pathlib.Path(sys.argv[1]).resolve();candidate=pathlib.Path(sys.argv[2]).resolve();out=pathlib.Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True);root=pathlib.Path(tempfile.mkdtemp(prefix='godie-streaming-'));results=[]
for label,binary in [('original',original),('candidate',candidate)]:
 home=root/label/'home';work=root/label/'work';home.mkdir(parents=True);work.mkdir();state=home/('.die/agent' if label=='original' else '.godie');state.mkdir(parents=True);seen=[];started=threading.Event();firstDone=threading.Event()
 class Handler(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_POST(self):
   body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));seen.append(body);number=len(seen);started.set();self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
   chunks=['STREAM_START ','STREAM_END'] if number==1 else ['SECOND_DONE']
   for text in chunks:
    self.wfile.write(('data: '+json.dumps({'id':'fixture','object':'chat.completion.chunk','model':'fixture','choices':[{'index':0,'delta':{'content':text},'finish_reason':None}]})+'\n\n').encode());self.wfile.flush();time.sleep(.6)
   self.wfile.write(('data: '+json.dumps({'id':'fixture','choices':[{'index':0,'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':10,'completion_tokens':3,'total_tokens':13}})+'\n\ndata: [DONE]\n\n').encode());self.wfile.flush()
   if number==1:firstDone.set()
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 (state/'models.json').write_text(json.dumps({'providers':{'loop':{'api':'openai-completions','baseUrl':'http://127.0.0.1:'+str(server.server_port)+'/v1','apiKey':'dummy-local','models':[{'id':'fixture','name':'Fixture','reasoning':False,'input':['text'],'contextWindow':32000,'maxTokens':4096,'cost':{'input':0,'output':0,'cacheRead':0,'cacheWrite':0}}]}}}))
 env={'HOME':str(home),'TMPDIR':str(root),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TERM':'xterm-256color','COLORTERM':'truecolor','PI_OFFLINE':'1','HERDR_ENV':'0','DIE_CODING_AGENT_DIR':str(state),'GODIE_STATE_DIR':str(state)}
 master,slave=pty.openpty();before=termios.tcgetattr(slave);fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,100,0,0))
 def child():os.setsid();fcntl.ioctl(slave,termios.TIOCSCTTY,0)
 p=subprocess.Popen([str(binary),'--no-approve','--provider','loop','--model','fixture','INITIAL_PROMPT'],cwd=work,env=env,stdin=slave,stdout=slave,stderr=slave,preexec_fn=child,close_fds=True);raw=bytearray()
 def drain(seconds):
  end=time.monotonic()+seconds
  while time.monotonic()<end:
   if select.select([master],[],[],min(.05,max(0,end-time.monotonic())))[0]:
    try:b=os.read(master,65536)
    except OSError:break
    if not b:break
    raw.extend(b)
 try:
  deadline=time.monotonic()+8
  while not started.is_set() and time.monotonic()<deadline:drain(.1)
  initialAuto=started.is_set()
  if initialAuto:
   os.write(master,'DRAFT_MARKER_界'.encode());drain(2);os.write(master,b'\r');drain(2)
  os.write(master,b'\x03');drain(.1);os.write(master,b'\x03');drain(1)
  if p.poll() is None:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=5)
  after=termios.tcgetattr(slave);draft=len(seen)>=2 and 'DRAFT_MARKER_界' in json.dumps(seen[1],ensure_ascii=False)
  passed=initialAuto and len(seen)==2 and draft and before[3]==after[3] and p.returncode==0
  d=out/label;d.mkdir(exist_ok=True);(d/'terminal.raw').write_bytes(raw);(d/'requests.json').write_text(json.dumps(seen,indent=2,ensure_ascii=False))
  results.append({'side':label,'status':'PASS' if passed else 'FAIL','binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'initialPromptAutoSubmitted':initialAuto,'requestCount':len(seen),'draftPreservedDuringStream':draft,'terminalRestored':before[3]==after[3],'exitCode':p.returncode,'panic':b'panic:' in raw})
 finally:
  if p.poll() is None:os.killpg(p.pid,signal.SIGKILL);p.wait()
  os.close(master);os.close(slave);server.shutdown();server.server_close()
manifest={'status':'PASS' if all(x['status']=='PASS' for x in results) else 'FAIL','internetUsed':False,'results':results};(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2));shutil.rmtree(root)
