#!/usr/bin/env python3
"""Independent black-box differential recorder for die and godie."""
from __future__ import annotations
import argparse, datetime, difflib, hashlib, http.server, json, os, pathlib, re, shutil, signal, socketserver, subprocess, tempfile, threading, time, uuid
from typing import Any
ROOT=pathlib.Path(__file__).resolve().parents[2]
ART=pathlib.Path(__file__).parent/'artifacts'
SAFE_PATH='/usr/local/bin:/usr/bin:/bin'
ANSI=re.compile(rb'(?:\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1bP.*?\x1b\\|\x1b[@-_][0-?]*[ -/]*[@-~])',re.S)
def digest(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''): h.update(b)
 return h.hexdigest()
def jwrite(p,v): p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def genv(home,tmp,agent=None):
 e={'HOME':str(home),'TMPDIR':str(tmp),'PATH':SAFE_PATH,'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TERM':'xterm-256color','COLORTERM':'truecolor','HERDR_ENV':'0','PI_OFFLINE':'1','NO_PROXY':'127.0.0.1,localhost'}
 if agent:e['DIE_CODING_AGENT_DIR']=str(agent)
 return e
def norm(b,roots):
 s=b.decode('utf-8','replace').replace('\r\n','\n')
 for p in sorted(map(str,roots),key=len,reverse=True):s=s.replace(p,'<TMP>')
 s=re.sub(r'(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b','<UUID>',s)
 s=re.sub(r'\b(task|call)_[A-Za-z0-9_-]+\b',lambda m:m.group(1)+'_<ID>',s)
 return re.sub(r'\b20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\b','<TIME>',s)
def proc(name,argv,env,cwd,out,roots,timeout=25):
 d=out/name;d.mkdir(parents=True,exist_ok=True);start=time.monotonic();to=False
 p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 try:so,se=p.communicate(timeout=timeout)
 except subprocess.TimeoutExpired:
  to=True;os.killpg(p.pid,signal.SIGTERM)
  try:so,se=p.communicate(timeout=2)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);so,se=p.communicate()
 (d/'stdout.raw').write_bytes(so);(d/'stderr.raw').write_bytes(se)
 (d/'stdout.normalized.txt').write_text(norm(so,roots));(d/'stderr.normalized.txt').write_text(norm(se,roots))
 r={'argv':argv,'exit_code':p.returncode,'timed_out':to,'duration_ms':round((time.monotonic()-start)*1000),'stdout_bytes':len(so),'stderr_bytes':len(se)};jwrite(d/'result.json',r);return r
def tx(tmux,sock,*args,check=True):return subprocess.run([tmux,'-L',sock,*args],capture_output=True,check=check)
def pty(binary,env,cwd,out,roots):
 d=out/'pty-editor-quit';d.mkdir(parents=True,exist_ok=True);tmux=shutil.which('tmux')
 if not tmux:r={'status':'BLOCKED','reason':'tmux unavailable'};jwrite(d/'result.json',r);return r
 sock='godie-accept-'+uuid.uuid4().hex;raw=d/'terminal.raw';frames={};start=time.monotonic();timed=False;status=None
 try:
  cmd=['env',*[f'{k}={v}' for k,v in env.items()],str(binary),'--offline','--no-session']
  tx(tmux,sock,'new-session','-d','-s','pty','-x','100','-y','30','-c',str(cwd),*cmd)
  tx(tmux,sock,'set-option','-t','pty','remain-on-exit','on');tx(tmux,sock,'pipe-pane','-o','-t','pty',f'cat >> {raw}')
  end=time.monotonic()+12
  while time.monotonic()<end:
   screen=tx(tmux,sock,'capture-pane','-p','-t','pty').stdout
   if b'/model' in screen and b'Startup is still in progress' not in screen:break
   if tx(tmux,sock,'display-message','-p','-t','pty','#{pane_dead}').stdout.strip()==b'1':break
   time.sleep(.1)
  frames['startup']=tx(tmux,sock,'capture-pane','-p','-e','-t','pty').stdout
  tx(tmux,sock,'send-keys','-t','pty','-l','ac');tx(tmux,sock,'send-keys','-t','pty','Left');tx(tmux,sock,'send-keys','-t','pty','-l','b');time.sleep(.4)
  frames['edited']=tx(tmux,sock,'capture-pane','-p','-e','-t','pty').stdout;tx(tmux,sock,'send-keys','-t','pty','BSpace','BSpace','BSpace');tx(tmux,sock,'send-keys','-t','pty','C-d');time.sleep(.4);tx(tmux,sock,'send-keys','-t','pty','C-c','C-c')
  end=time.monotonic()+5
  while time.monotonic()<end:
   if tx(tmux,sock,'display-message','-p','-t','pty','#{pane_dead}').stdout.strip()==b'1':break
   time.sleep(.1)
  else:timed=True;tx(tmux,sock,'send-keys','-t','pty','C-c',check=False)
  frames['final']=tx(tmux,sock,'capture-pane','-p','-e','-S','-','-t','pty').stdout
  z=tx(tmux,sock,'display-message','-p','-t','pty','#{pane_dead_status}').stdout.strip();status=int(z) if z.isdigit() else None
 finally:tx(tmux,sock,'kill-server',check=False)
 if not raw.exists():raw.write_bytes(b'')
 for n,b in frames.items():(d/(n+'.ansi')).write_bytes(b);(d/(n+'.txt')).write_text(norm(ANSI.sub(b'',b),roots))
 r={'argv':[str(binary),'--offline','--no-session'],'driver':'isolated tmux PTY 100x30','editor_drive':'literal ac, Left, literal b, 3x Backspace, Ctrl-D, 2x Ctrl-C fallback','exit_code':status,'timed_out':timed,'raw_bytes':raw.stat().st_size,'duration_ms':round((time.monotonic()-start)*1000)};jwrite(d/'result.json',r);return r
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):
 daemon_threads=True
 def __init__(self,path):self.seen=[];self.path=path;super().__init__(('127.0.0.1',0),Handler)
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_POST(self):
  raw=self.rfile.read(int(self.headers.get('content-length','0')))
  try:b=json.loads(raw)
  except:b={}
  self.server.seen.append({'ordinal':len(self.server.seen)+1,'path':self.path,'header_names':sorted(k.lower() for k in self.headers),'top_level_keys':sorted(b),'model':b.get('model'),'stream':b.get('stream'),'message_roles':[x.get('role') for x in b.get('messages',[]) if isinstance(x,dict)],'tool_names':[x.get('function',{}).get('name') for x in b.get('tools',[]) if isinstance(x,dict)],'fixture_markers':{m:(m in raw.decode('utf-8','replace')) for m in ['LAUNCHED','FIRST','FINAL','JOB_BEGIN','JOB_END','FIXTURE_DONE']}});jwrite(self.server.path,self.server.seen)
  first=len(self.server.seen)==1
  code='const j=await shell("printf JOB_BEGIN; sleep 0.2; printf JOB_END",{waitSeconds:0}); console.log("LAUNCHED",j.status,j.background); const a=await jobs.inspect(j.id); console.log("FIRST",a.status); await Bun.sleep(350); const b=await jobs.inspect(j.id); console.log("FINAL",b.status,b.output);'
  delta={'role':'assistant','tool_calls':[{'index':0,'id':'fixture_call','type':'function','function':{'name':'execute','arguments':json.dumps({'code':code})}}]} if first else {'role':'assistant','content':'FIXTURE_DONE'}
  finish='tool_calls' if first else 'stop';events=[{'id':'fixture-id','object':'chat.completion.chunk','created':1700000000,'model':'fixture-model','choices':[{'index':0,'delta':delta,'finish_reason':None}]},{'id':'fixture-id','object':'chat.completion.chunk','created':1700000000,'model':'fixture-model','choices':[{'index':0,'delta':{},'finish_reason':finish}]}]
  data=''.join('data: '+json.dumps(x,separators=(',',':'))+'\n\n' for x in events)+'data: [DONE]\n\n';raw=data.encode();self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
def fixture(binary,home,tmp,cwd,out,roots):
 d=out/'fake-provider-execute-job';d.mkdir(parents=True,exist_ok=True);s=Server(d/'requests.redacted.json');threading.Thread(target=s.serve_forever,daemon=True).start();port=s.server_address[1]
 cfg={'providers':{'fixture':{'baseUrl':f'http://127.0.0.1:{port}/v1','api':'openai-completions','apiKey':'fixture-not-secret','models':[{'id':'fixture-model','name':'fixture','contextWindow':32000,'maxTokens':1000}]}}}
 agent=home/'.die'/'agent';godie=home/'.godie'/'agent';agent.mkdir(parents=True,exist_ok=True);godie.mkdir(parents=True,exist_ok=True);jwrite(agent/'models.json',cfg);jwrite(godie/'models.json',cfg)
 env=genv(home,tmp,agent)
 try:r=proc('process',[str(binary),'--no-session','--provider','fixture','--model','fixture-model','-p','acceptance-fixture'],env,cwd,d,roots,35)
 finally:s.shutdown();s.server_close()
 r.update({'request_count':len(s.seen),'transport':'loopback fixture'});jwrite(d/'result.json',r);return r
def gitinfo():
 def g(*a):
  p=subprocess.run(['git',*a],cwd=ROOT,text=True,capture_output=True);return p.stdout.strip() if p.returncode==0 else ''
 return {'revision':g('rev-parse','HEAD'),'describe':g('describe','--always','--dirty'),'binary_tracked':bool(g('ls-files','--','dist/die')),'worktree_status':g('status','--short')}
def state(home):
 out=[]
 for p in sorted(home.rglob('*')):
  st=p.lstat();rel=re.sub(r'--tmp-godie-validation-[A-Za-z0-9_]+-(?:baseline|candidate)-workspace--','<WORKSPACE>',str(p.relative_to(home)));r={'path':rel,'mode':oct(st.st_mode&0o777),'size':st.st_size,'type':'symlink' if p.is_symlink() else 'file' if p.is_file() else 'dir' if p.is_dir() else 'other'}
  if p.is_file():r['sha256']=digest(p)
  if p.is_symlink():r['target']=os.readlink(p)
  out.append(r)
 return out
def target(binary,label,out,root):
 home=root/label/'home';tmp=root/label/'tmp';cwd=root/label/'workspace'
 for p in (home,tmp,cwd):p.mkdir(parents=True,exist_ok=True)
 roots=[root,home,tmp,cwd];env=genv(home,tmp,home/'.die'/'agent');st=binary.stat();jwrite(out/'metadata.json',{'label':label,'path':str(binary),'sha256':digest(binary),'size':st.st_size,'mtime_utc':datetime.datetime.fromtimestamp(st.st_mtime,datetime.timezone.utc).isoformat(),'source_revision_at_recording':gitinfo(),'built_from_current_source':'unverified: executable has no source-revision provenance'})
 tests={'version':['--version'],'help':['--help'],'error-no-tools':['--no-tools'],'error-no-builtin-tools':['--no-builtin-tools'],'error-tools':['--tools=read'],'error-exclude-tools':['--exclude-tools=bash'],'error-update':['update'],'error-unknown-option':['--definitely-invalid-acceptance-option']};summary={}
 for n,a in tests.items():summary[n]=proc(n,[str(binary),*a],env,cwd,out,roots)
 summary['pty-editor-quit']=pty(binary,env,cwd,out,roots);summary['fake-provider-execute-job']=fixture(binary,home,tmp,cwd,out,roots);jwrite(out/'state-manifest.json',state(home));jwrite(out/'summary.json',summary)
def compare(a,b,out):
 rows=[]
 for n in sorted({x.parent.name for x in a.glob('*/result.json')}|{x.parent.name for x in b.glob('*/result.json')}):
  dif=[]
  for f in ['result.json','stdout.normalized.txt','stderr.normalized.txt','startup.txt','edited.txt','final.txt','requests.redacted.json']:
   x=a/n/f;y=b/n/f
   if not(x.exists() or y.exists()):continue
   av=x.read_text(errors='replace').splitlines(True) if x.exists() else [];bv=y.read_text(errors='replace').splitlines(True) if y.exists() else []
   if f=='result.json' and x.exists() and y.exists():
    aa=json.loads(x.read_text());bb=json.loads(y.read_text())
    for q in (aa,bb):q.pop('duration_ms',None);q.pop('argv',None)
    av=json.dumps(aa,indent=2,sort_keys=True).splitlines(True);bv=json.dumps(bb,indent=2,sort_keys=True).splitlines(True)
   if av!=bv:dif.extend(difflib.unified_diff(av,bv,fromfile='baseline/'+n+'/'+f,tofile='candidate/'+n+'/'+f))
  rows.append({'scenario':n,'status':'PASS' if not dif else 'FAIL','diff':''.join(dif)})
 jwrite(out/'diff.json',{'candidate_actually_run':True,'parity_claimed':False,'comparisons':rows})
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--baseline',required=True,type=pathlib.Path);ap.add_argument('--candidate',type=pathlib.Path);ap.add_argument('--output',type=pathlib.Path);a=ap.parse_args()
 for p in (a.baseline,a.candidate):
  if p is not None and not(p.exists() and os.access(p,os.X_OK)):ap.error('not an executable: '+str(p))
 out=(a.output or ART/('run-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))).resolve();out.mkdir(parents=True,exist_ok=True);root=pathlib.Path(tempfile.mkdtemp(prefix='godie-validation-'))
 manifest={'schema':1,'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseline':str(a.baseline.resolve()),'candidate':str(a.candidate.resolve()) if a.candidate else None,'candidate_actually_run':False,'parity_claimed':False,'normalization':['isolated paths','UUIDs','task/call IDs','ISO UTC timestamps']}
 try:
  target(a.baseline.resolve(),'baseline',out/'baseline',root)
  if a.candidate:target(a.candidate.resolve(),'candidate',out/'candidate',root);manifest['candidate_actually_run']=True;compare(out/'baseline',out/'candidate',out)
  jwrite(out/'manifest.json',manifest);print(out)
 finally:shutil.rmtree(root,ignore_errors=True)
if __name__=='__main__':main()
