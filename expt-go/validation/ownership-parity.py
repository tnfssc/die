#!/usr/bin/env python3
"""Black-box app/provider completion ownership differential.

Only talks to loopback fake providers.  It drives execute via actual model tool calls;
it never uses --execute.  Every CLI owns a new process group and cleanup targets only
that exact group.
"""
from __future__ import annotations
import argparse, datetime, hashlib, http.server, json, os, pathlib, re, shutil
import signal, socketserver, subprocess, tempfile, threading, time

ROOT=pathlib.Path(__file__).resolve().parents[2]
DEFAULT_OUT=ROOT/'artifacts'/'ownership-latest'
MARKERS=['OWN_FG_RESULT','OWN_FG_PAYLOAD','OWN_BG_LAUNCH','OWN_BG_DONE','OWN_BG_HANDOFF',
 'OWN_CRASH_RESULT','OWN_CRASH_PAYLOAD','OWN_PAR_LAUNCH','OWN_PAR_DONE','OWN_PAR_HANDOFF',
 'OWN_SURVIVE_LAUNCH','OWN_SURVIVE_DONE','OWN_SURVIVE_PARK','completed','completion','job']
SCENARIOS={
 'foreground-no-duplicate': {
  'code': 'const r=await shell("printf OWN_FG_PAYLOAD",{waitSeconds:5}); console.log("OWN_FG_RESULT",r.status,r.exitCode,r.output);',
  'final_at': 2, 'budget': 3, 'expect_at':{2:['OUTPUT:OWN_FG_RESULT','OUTPUT:OWN_FG_PAYLOAD']}},
 'background-resumes-once': {
  'code': 'const j=await shell("sleep 0.35; printf OWN_BG_DONE",{waitSeconds:0}); console.log("OWN_BG_LAUNCH",j.status,j.background); await handoff("OWN_BG_HANDOFF");',
  'final_at': 2, 'budget': 3, 'expect_at':{2:['OUTPUT:OWN_BG_DONE','COMPLETION_NOTICE']}},
 'runner-crash-restores-notice': {
  'code': 'const r=await shell("printf OWN_CRASH_PAYLOAD",{waitSeconds:5}); console.log("OWN_CRASH_RESULT",r.status,r.output); process.exit(23);',
  'final_at': 3, 'budget': 4, 'expect_at':{2:['OUTPUT:OWN_CRASH_RESULT','OUTPUT:OWN_CRASH_PAYLOAD'],3:['OUTPUT:OWN_CRASH_PAYLOAD','COMPLETION_NOTICE']}},
 'parallel-handoff': {
  'code': 'const p=shell("sleep 0.35; printf OWN_PAR_DONE",{waitSeconds:5}); await Bun.sleep(60); console.log("OWN_PAR_LAUNCH"); await handoff("OWN_PAR_HANDOFF"); await p;',
  'final_at': 2, 'budget': 3, 'expect_at':{2:['OUTPUT:OWN_PAR_DONE','COMPLETION_NOTICE']}},
 'pending-job-survives-runner': {
  'code': 'const j=await shell("sleep 0.55; printf OWN_SURVIVE_DONE",{waitSeconds:0}); console.log("OWN_SURVIVE_LAUNCH",j.status,j.background);',
  'responses': ['tool','park','final'], 'final_at':3, 'budget':4, 'expect_at':{2:['OUTPUT:OWN_SURVIVE_LAUNCH'],3:['OUTPUT:OWN_SURVIVE_DONE','COMPLETION_NOTICE']}},
}

def sha(p):
 h=hashlib.sha256();
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def dump(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def strings(v):
 if isinstance(v,str):yield v
 elif isinstance(v,list):
  for x in v:yield from strings(x)
 elif isinstance(v,dict):
  for x in v.values():yield from strings(x)
def summarize(body,ordinal,path):
 leaves=list(strings(body)); alltext='\n'.join(leaves); hits={m:(m in alltext) for m in MARKERS}
 for m in MARKERS:
  hits['OUTPUT:'+m]=any(m in leaf and 'const ' not in leaf and 'shell(' not in leaf for leaf in leaves)
 hits['COMPLETION_NOTICE']=(('Background job ' in alltext and (' completed.' in alltext or ' failed.' in alltext)) or ('Command: ' in alltext and any(hits.get('OUTPUT:'+m) for m in MARKERS if m.startswith('OWN_'))))
 snippets=[]
 for line in alltext.splitlines():
  if 'OWN_' in line or 'Background job ' in line: snippets.append(line[:1200])
 # Structural order is retained, while prompts/system text and credentials are not.
 seq=[]
 source=body.get('messages',body.get('input',[])) if isinstance(body,dict) else []
 if isinstance(source,list):
  for x in source:
   if isinstance(x,dict):seq.append({'role':x.get('role'),'type':x.get('type'),'name':x.get('name'),'call_id':x.get('call_id')})
 return {'ordinal':ordinal,'path':path,'top_level_keys':sorted(body) if isinstance(body,dict) else [],
  'model':body.get('model') if isinstance(body,dict) else None,'stream':body.get('stream') if isinstance(body,dict) else None,
  'sequence':seq,'marker_hits':hits,'marker_snippets':snippets[:30]}

def completion_sse(item):
 delta={'role':'assistant'}
 if item['kind']=='tool':delta['tool_calls']=[{'index':0,'id':item['id'],'type':'function','function':{'name':'execute','arguments':json.dumps({'code':item['code']})}}]
 else:delta['content']=item['text']
 finish='tool_calls' if item['kind']=='tool' else 'stop'
 events=[{'id':'ownership','object':'chat.completion.chunk','created':1700000000,'model':'ownership-model','choices':[{'index':0,'delta':delta,'finish_reason':None}]},
 {'id':'ownership','object':'chat.completion.chunk','created':1700000000,'model':'ownership-model','choices':[{'index':0,'delta':{},'finish_reason':finish}]}]
 return ''.join('data: '+json.dumps(e,separators=(',',':'))+'\n\n' for e in events)+'data: [DONE]\n\n'
def responses_sse(item):
 if item['kind']=='tool': out={'type':'function_call','id':'fc_'+item['id'],'call_id':item['id'],'name':'execute','arguments':json.dumps({'code':item['code']})}
 else: out={'type':'message','id':'msg_final','role':'assistant','content':[{'type':'output_text','text':item['text'],'annotations':[]}]}
 resp={'id':'resp_ownership','object':'response','status':'completed','model':'ownership-model','output':[out],
  'usage':{'input_tokens':1,'output_tokens':1,'input_tokens_details':{'cached_tokens':0}}}
 events=[{'type':'response.output_item.added','output_index':0,'item':out},{'type':'response.output_item.done','output_index':0,'item':out},{'type':'response.completed','response':resp}]
 return ''.join('event: '+e['type']+'\ndata: '+json.dumps(e,separators=(',',':'))+'\n\n' for e in events)
def planned(spec,n):
 if n==1:return {'kind':'tool','id':'ownership_call_1','code':spec['code']}
 if spec.get('responses') and n==2:return {'kind':'tool','id':'ownership_call_2','code':'await handoff("OWN_SURVIVE_PARK");'}
 return {'kind':'final','text':'OWNERSHIP_FINAL'}
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):
 daemon_threads=True
 def __init__(self,spec,log):self.spec=spec;self.log=log;self.seen=[];self.lock=threading.Lock();super().__init__(('127.0.0.1',0),Handler)
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  raw=self.rfile.read(int(self.headers.get('content-length','0')))
  try:body=json.loads(raw)
  except Exception:body={}
  with self.server.lock:
   n=len(self.server.seen)+1; rec=summarize(body,n,self.path);self.server.seen.append(rec);dump(self.server.log,self.server.seen)
  if n>self.server.spec['budget']:
   data=json.dumps({'error':{'message':'ownership request budget exceeded'}}).encode();self.send_response(429);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  item=planned(self.server.spec,n)
  if self.path.endswith('/responses'):
   data=responses_sse(item).encode();ctype='text/event-stream'
  else:
   data=completion_sse(item).encode();ctype='text/event-stream'
  self.send_response(200);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

def env_for(home,tmp):
 e={'HOME':str(home),'TMPDIR':str(tmp),'PATH':os.environ.get('PATH','/usr/bin:/bin'),'TERM':'dumb','NO_COLOR':'1',
    'DIE_AGENT_DIR':str(home/'.die'/'agent'),'OPENAI_API_KEY':'ownership-dummy-fixture-key'}
 for k in ('LANG','LC_ALL'): 
  if k in os.environ:e[k]=os.environ[k]
 return e
def configure_baseline(home,port):
 cfg={'providers':{'ownership':{'baseUrl':f'http://127.0.0.1:{port}/v1','api':'openai-completions','apiKey':'ownership-dummy-fixture-key','models':[{'id':'ownership-model','name':'ownership','contextWindow':32000,'maxTokens':1000}]}}}
 for d in (home/'.die'/'agent',home/'.godie'/'agent'):
  d.mkdir(parents=True,exist_ok=True);dump(d/'models.json',cfg)
def command(binary,label,home,port):
 common=[str(binary),'--no-session','--provider']
 if label=='baseline':return common+['ownership','--model','ownership-model','-p','ownership-black-box']
 return common+['openai','--model','ownership-model','--api-key','ownership-dummy-fixture-key','--base-url',f'http://127.0.0.1:{port}/v1','-p','ownership-black-box']
def run_one(binary,label,name,spec,out,temp):
 d=out/label/name;d.mkdir(parents=True,exist_ok=True); home=temp/label/name/'home';tmp=temp/label/name/'tmp';cwd=temp/label/name/'workspace'
 for x in (home,tmp,cwd):x.mkdir(parents=True,exist_ok=True)
 srv=Server(spec,d/'requests.redacted.json');threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1]
 configure_baseline(home,port);argv=command(binary,label,home,port);start=time.monotonic();timed=False
 p=subprocess.Popen(argv,cwd=cwd,env=env_for(home,tmp),stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 try:
  so,se=p.communicate(timeout=8)
 except subprocess.TimeoutExpired:
  timed=True
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  try:so,se=p.communicate(timeout=1.5)
  except subprocess.TimeoutExpired:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   so,se=p.communicate()
 finally:srv.shutdown();srv.server_close()
 (d/'stdout.raw').write_bytes(so);(d/'stderr.raw').write_bytes(se)
 req=srv.seen; expected={}
 for ordinal,markers in spec['expect_at'].items():
  rec=req[ordinal-1] if len(req)>=ordinal else {'marker_hits':{}}
  for marker in markers:expected[f'request_{ordinal}:{marker}']=bool(rec['marker_hits'].get(marker))
 expected_count=spec['final_at']; status='PASS' if (not timed and p.returncode==0 and len(req)==expected_count and all(expected.values())) else 'FAIL'
 result={'status':status,'scenario':name,'adapter':'models.json openai-completions' if label=='baseline' else 'CLI openai --base-url Responses',
  'argv_redacted':[('<DUMMY_KEY>' if x=='ownership-dummy-fixture-key' else x) for x in argv], 'exit_code':p.returncode,'timed_out':timed,
  'duration_ms':round((time.monotonic()-start)*1000),'request_count':len(req),'request_order':[r['ordinal'] for r in req],
  'request_paths':[r['path'] for r in req],'expected_request_count':expected_count,'expected_markers_seen':expected,
  'actual_marker_snippets':[s for r in req for s in r['marker_snippets']], 'stdout_text':so.decode(errors='replace'),'stderr_text':se.decode(errors='replace'),
  'cleanup':{'process_group':p.pid,'method':'natural exit' if not timed else 'SIGTERM then SIGKILL only if needed'}}
 dump(d/'result.json',result);return result

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--baseline',type=pathlib.Path,default=ROOT/'expt-go/bin/die-original');ap.add_argument('--candidate',type=pathlib.Path,default=ROOT/'expt-go/bin/godie');ap.add_argument('--output',type=pathlib.Path,default=DEFAULT_OUT);a=ap.parse_args()
 out=a.output.resolve();shutil.rmtree(out,ignore_errors=True);out.mkdir(parents=True);temp=pathlib.Path(tempfile.mkdtemp(prefix='ownership-validation-')); results={}
 try:
  for label,b in [('baseline',a.baseline.resolve()),('candidate',a.candidate.resolve())]:
   if not (b.is_file() and os.access(b,os.X_OK)):raise SystemExit('not executable: '+str(b))
   results[label]={n:run_one(b,label,n,s,out,temp) for n,s in SCENARIOS.items()}
  manifest={'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseline':str(a.baseline.resolve()),'baseline_sha256':sha(a.baseline),
   'candidate':str(a.candidate.resolve()),'candidate_sha256':sha(a.candidate),'internet_used':False,'real_credentials_used':False,
   'same_execute_code':True,'scenario_results':{l:{n:r['status'] for n,r in rs.items()} for l,rs in results.items()}}
  dump(out/'manifest.json',manifest);print(out)
 finally:shutil.rmtree(temp,ignore_errors=True)
if __name__=='__main__':main()
