#!/usr/bin/env python3
"""Black-box persisted-session/replay acceptance for die-original and godie.

All provider traffic is loopback, credentials are dummy, state is disposable, and
processes are killed only by their exact process group on a deadline.
"""
import argparse, datetime, hashlib, http.server, importlib.util, json, os, pathlib, shutil, signal, socketserver, subprocess, tempfile, threading, time

HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parent.parent
DEFAULT_OUT=ROOT/'artifacts'/'session-replay-run'
_spec=importlib.util.spec_from_file_location('ownership_parity',HERE/'ownership-parity.py')
own=importlib.util.module_from_spec(_spec); _spec.loader.exec_module(own)
DUMMY='session-replay-dummy-key'
MARKERS=['SR_FIRST_PROMPT','SR_TOOL_OUTPUT','SR_FIRST_FINAL','SR_RESTART_PROMPT','SR_RESTART_FINAL','/sr-literal-command','SR_LITERAL_FINAL','SR_ABORT_PARTIAL_SUCCESS','SR_BRANCH_A_SECRET','SR_BRANCH_B_SECRET','SR_HISTORY_RESULT','SR_HISTORY_FINAL']

def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def dump(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def leaves(v):
 if isinstance(v,str):yield v
 elif isinstance(v,list):
  for x in v:yield from leaves(x)
 elif isinstance(v,dict):
  for x in v.values():yield from leaves(x)
def summary(body,n,path):
 ss=list(leaves(body)); text='\n'.join(ss)
 seq=[]
 source=body.get('messages',body.get('input',[])) if isinstance(body,dict) else []
 if isinstance(source,list):
  for x in source:
   if isinstance(x,dict):seq.append({k:x.get(k) for k in ('role','type','name','call_id') if x.get(k) is not None})
 return {'ordinal':n,'path':path,'model':body.get('model') if isinstance(body,dict) else None,'sequence':seq,
  'marker_hits':{m:(m in text) for m in MARKERS},
  'marker_snippets':[s[:1400] for s in ss if any(m in s for m in MARKERS)][:40]}

class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):
 daemon_threads=True
 def __init__(self,actions,log):self.actions=actions;self.log=log;self.seen=[];self.lock=threading.Lock();super().__init__(('127.0.0.1',0),Handler)
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  raw=self.rfile.read(int(self.headers.get('content-length','0')))
  try:body=json.loads(raw)
  except Exception:body={}
  with self.server.lock:
   n=len(self.server.seen)+1; rec=summary(body,n,self.path);self.server.seen.append(rec);dump(self.server.log,self.server.seen)
  if n>len(self.server.actions):
   data=json.dumps({'error':{'message':'session replay request budget exceeded'}}).encode();self.send_response(429);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  action=self.server.actions[n-1]
  if action['kind']=='abort':
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers()
   # Deliberately omit terminal response.completed / finish_reason / [DONE].
   if self.path.endswith('/responses'):
    out={'type':'message','id':'msg_abort','role':'assistant','content':[{'type':'output_text','text':'SR_ABORT_PARTIAL_SUCCESS','annotations':[]}]}
    data='event: response.output_item.added\ndata: '+json.dumps({'type':'response.output_item.added','output_index':0,'item':out})+'\n\n'
   else:
    e={'id':'abort','object':'chat.completion.chunk','created':1700000000,'model':'session-model','choices':[{'index':0,'delta':{'role':'assistant','content':'SR_ABORT_PARTIAL_SUCCESS'},'finish_reason':None}]}
    data='data: '+json.dumps(e)+'\n\n'
   self.wfile.write(data.encode());self.wfile.flush();self.close_connection=True;return
  item={'kind':action['kind']}
  if action['kind']=='tool':item.update(id=action.get('id','sr_call'),code=action['code'])
  else:item['text']=action['text']
  data=(own.responses_sse(item) if self.path.endswith('/responses') else own.completion_sse(item)).encode()
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

def env_for(home,tmp):
 e={'HOME':str(home),'TMPDIR':str(tmp),'PATH':os.environ.get('PATH','/usr/bin:/bin'),'TERM':'dumb','NO_COLOR':'1','DIE_AGENT_DIR':str(home/'.die'/'agent'),'OPENAI_API_KEY':DUMMY}
 for k in ('LANG','LC_ALL'):
  if k in os.environ:e[k]=os.environ[k]
 return e
def configure_baseline(home,port):
 cfg={'providers':{'session-fixture':{'baseUrl':f'http://127.0.0.1:{port}/v1','api':'openai-completions','apiKey':DUMMY,'models':[{'id':'session-model','name':'session fixture','contextWindow':32000,'maxTokens':2000}]}}}
 d=home/'.die'/'agent';d.mkdir(parents=True,exist_ok=True);dump(d/'models.json',cfg)
def provider_args(label,port):
 if label=='baseline':return ['--provider','session-fixture','--model','session-model']
 return ['--provider','openai','--model','session-model','--api-key',DUMMY,'--base-url',f'http://127.0.0.1:{port}/v1']
def run(argv,cwd,env,out,tag,timeout=8):
 start=time.monotonic(); timed=False; method='natural exit'
 p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 try:so,se=p.communicate(timeout=timeout)
 except subprocess.TimeoutExpired:
  timed=True;method='SIGTERM to exact process group'
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  try:so,se=p.communicate(timeout=1.5)
  except subprocess.TimeoutExpired:
   method+='; SIGKILL to exact process group'
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   so,se=p.communicate()
 rec={'argv_redacted':['<DUMMY_KEY>' if x==DUMMY else x for x in argv],'exit_code':p.returncode,'timed_out':timed,'duration_ms':round((time.monotonic()-start)*1000),'stdout_text':so.decode(errors='replace'),'stderr_text':se.decode(errors='replace'),'process_group':p.pid,'cleanup':method}
 dump(out/(tag+'.json'),rec);(out/(tag+'.stdout.raw')).write_bytes(so);(out/(tag+'.stderr.raw')).write_bytes(se);return rec
def session_files(session_dir):return sorted(session_dir.rglob('*.jsonl'),key=lambda p:p.stat().st_mtime_ns)
def persisted(files):
 result=[]
 for p in files:
  lines=[]
  for i,line in enumerate(p.read_text(errors='replace').splitlines(),1):
   try:v=json.loads(line)
   except Exception:v={'invalid_json':line[:500]}
   raw=json.dumps(v,ensure_ascii=False)
   lines.append({'line':i,'type':v.get('type') if isinstance(v,dict) else None,'role':v.get('role') if isinstance(v,dict) else None,'marker_hits':[m for m in MARKERS if m in raw],'record':v if len(raw)<=7000 else raw[:7000]+'…'})
  result.append({'path':str(p),'lines':lines})
 return result
def setup(label,binary,name,out,temp,actions):
 d=out/label/name;d.mkdir(parents=True,exist_ok=True);root=temp/label/name;home=root/'home';tmp=root/'tmp';cwd=root/'workspace';sessions=root/'sessions'
 for x in (home,tmp,cwd,sessions):x.mkdir(parents=True,exist_ok=True)
 srv=Server(actions,d/'requests.redacted.json');threading.Thread(target=srv.serve_forever,daemon=True).start();configure_baseline(home,srv.server_address[1])
 base=[str(binary)]+provider_args(label,srv.server_address[1])+['--session-dir',str(sessions),'-p'];return d,home,tmp,cwd,sessions,srv,base

def scenario_persist(label,binary,out,temp):
 actions=[{'kind':'tool','id':'sr_tool_1','code':'console.log("SR_TOOL_OUTPUT", "persisted-through-execute");'},{'kind':'final','text':'SR_FIRST_FINAL'},{'kind':'final','text':'SR_RESTART_FINAL'}]
 d,h,t,c,s,srv,base=setup(label,binary,'persist-tool-restart',out,temp,actions);env=env_for(h,t)
 r1=run(base+['SR_FIRST_PROMPT'],c,env,d,'process-1'); files=session_files(s); path=files[-1] if files else None
 r2=run(base[:-1]+['--continue','-p','SR_RESTART_PROMPT'],c,env,d,'process-2')
 dump(d/'persisted-summary.json',persisted(session_files(s)));srv.shutdown();srv.server_close()
 req=srv.seen; hits=req[2]['marker_hits'] if len(req)>2 else {}
 needed=['SR_FIRST_PROMPT','SR_TOOL_OUTPUT','SR_FIRST_FINAL','SR_RESTART_PROMPT']
 status='PASS' if r1['exit_code']==0 and r2['exit_code']==0 and len(req)==3 and all(hits.get(x) for x in needed) else 'FAIL'
 res={'status':status,'process_exits':[r1['exit_code'],r2['exit_code']],'request_count':len(req),'restart_request_marker_hits':{x:hits.get(x,False) for x in needed},'session_file':str(path) if path else None};dump(d/'result.json',res);return res

def scenario_literal(label,binary,out,temp):
 d,h,t,c,s,srv,base=setup(label,binary,'print-slash-literal',out,temp,[{'kind':'final','text':'SR_LITERAL_FINAL'}]);r=run(base+['/sr-literal-command'],c,env_for(h,t),d,'process');dump(d/'persisted-summary.json',persisted(session_files(s)));srv.shutdown();srv.server_close()
 seen=len(srv.seen)==1 and srv.seen[0]['marker_hits'].get('/sr-literal-command');status='PASS' if r['exit_code']==0 and seen and 'SR_LITERAL_FINAL' in r['stdout_text'] else 'FAIL';res={'status':status,'exit_code':r['exit_code'],'request_count':len(srv.seen),'literal_reached_provider':bool(seen),'stdout':r['stdout_text'],'stderr':r['stderr_text']};dump(d/'result.json',res);return res

def scenario_abort(label,binary,out,temp):
 d,h,t,c,s,srv,base=setup(label,binary,'aborted-sse',out,temp,[{'kind':'abort'}]);r=run(base+['SR_ABORT_REQUEST'],c,env_for(h,t),d,'process',timeout=4);snap=persisted(session_files(s));dump(d/'persisted-summary.json',snap);srv.shutdown();srv.server_close();raw=json.dumps(snap)
 persisted_success='SR_ABORT_PARTIAL_SUCCESS' in raw;silent_success=(r['exit_code']==0 and persisted_success);status='PASS' if not silent_success and r['exit_code']!=0 and not persisted_success else 'FAIL';res={'status':status,'exit_code':r['exit_code'],'request_count':len(srv.seen),'partial_text_stdout':'SR_ABORT_PARTIAL_SUCCESS' in r['stdout_text'],'partial_success_persisted':persisted_success,'silent_success':silent_success,'stderr':r['stderr_text']};dump(d/'result.json',res);return res

def scenario_history(label,binary,out,temp):
 code='const s=await history.search({query:"SR_BRANCH_A_SECRET",limit:10,excerptChars:200}); let r=null; if(s.matches?.[0]?.ref) r=await history.read({ref:s.matches[0].ref,maxChars:2000}); console.log("SR_HISTORY_RESULT",JSON.stringify({search:s,read:r}));'
 acts=[{'kind':'final','text':'A_ACK'},{'kind':'final','text':'B_ACK'},{'kind':'tool','id':'sr_history','code':code},{'kind':'final','text':'SR_HISTORY_FINAL'}]
 d,h,t,c,s,srv,base=setup(label,binary,'history-branch-scope',out,temp,acts);env=env_for(h,t)
 a=run(base+['SR_BRANCH_A_SECRET'],c,env,d,'branch-a-create');fa=session_files(s);ap=fa[-1] if fa else None
 time.sleep(.03);b=run(base+['SR_BRANCH_B_SECRET'],c,env,d,'branch-b-create')
 ar=run(base[:-1]+(['--session',str(ap),'-p'] if ap else ['--continue','-p'])+['search own branch'],c,env,d,'branch-a-restart')
 dump(d/'persisted-summary.json',persisted(session_files(s)));srv.shutdown();srv.server_close();last=srv.seen[3] if len(srv.seen)>3 else {'marker_hits':{},'marker_snippets':[]};joined='\n'.join(last.get('marker_snippets',[]))
 status='PASS' if all(x['exit_code']==0 for x in (a,b,ar)) and len(srv.seen)==4 and last['marker_hits'].get('SR_BRANCH_A_SECRET') and not last['marker_hits'].get('SR_BRANCH_B_SECRET') and 'SR_HISTORY_RESULT' in joined else 'FAIL'
 res={'status':status,'process_exits':[a['exit_code'],b['exit_code'],ar['exit_code']],'request_count':len(srv.seen),'history_result_seen':('SR_HISTORY_RESULT' in joined),'own_marker_seen':bool(last['marker_hits'].get('SR_BRANCH_A_SECRET')),'foreign_marker_seen':bool(last['marker_hits'].get('SR_BRANCH_B_SECRET')),'resumed_session':str(ap) if ap else None};dump(d/'result.json',res);return res

def scenario_native_switch_probe(binary,out,temp):
 # The former probe emitted Responses SSE to Anthropic and had no passing path.
 # Real two-provider acceptance now lives in provenance-acceptance.py.
 res={'status':'NOT_RUN','reason':'Run provenance-acceptance.py: valid Responses/Anthropic native-replay and opaque-checkpoint scenarios are separate from this session suite.'}
 dump(out/'candidate'/'native-provider-switch'/'result.json',res)
 return res

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--baseline',type=pathlib.Path,default=ROOT/'expt-go/bin/die-original');ap.add_argument('--candidate',type=pathlib.Path,default=ROOT/'expt-go/bin/godie');ap.add_argument('--output',type=pathlib.Path,default=DEFAULT_OUT);a=ap.parse_args();out=a.output.resolve();shutil.rmtree(out,ignore_errors=True);out.mkdir(parents=True);temp=pathlib.Path(tempfile.mkdtemp(prefix='session-replay-validation-'));results={}
 try:
  for label,b0 in [('baseline',a.baseline),('candidate',a.candidate)]:
   b=b0.resolve();results[label]={};
   for name,fn in [('persist-tool-restart',scenario_persist),('print-slash-literal',scenario_literal),('aborted-sse',scenario_abort),('history-branch-scope',scenario_history)]:results[label][name]=fn(label,b,out,temp)
   if label=='candidate':results[label]['native-provider-switch']=scenario_native_switch_probe(b,out,temp)
  manifest={'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseline':str(a.baseline.resolve()),'baseline_sha256':sha(a.baseline),'candidate':str(a.candidate.resolve()),'candidate_sha256':sha(a.candidate),'internet_used':False,'real_credentials_or_state_used':False,'provider_adapters':{'baseline':'isolated models.json OpenAI Chat Completions loopback','candidate':'supported OpenAI Responses --base-url loopback'},'results':{l:{n:r['status'] for n,r in rs.items()} for l,rs in results.items()}}
  dump(out/'manifest.json',manifest);print(out)
 finally:shutil.rmtree(temp,ignore_errors=True)
if __name__=='__main__':main()
