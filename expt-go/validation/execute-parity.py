#!/usr/bin/env python3
"""Loopback-only black-box execute parity harness; never uses --execute."""
from __future__ import annotations
import argparse,base64,datetime,hashlib,http.server,json,os,pathlib,re,shutil,signal,socketserver,subprocess,tempfile,threading,time
ROOT=pathlib.Path(__file__).resolve().parents[2]; DEFAULT=ROOT/'artifacts'/'execute-parity-final'; KEY='execute-parity-dummy-key'; MODEL='execute-parity-model'
PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
SCENARIOS={
'language-modules':{'code':r'''import {typed,awaited as localAwaited} from "./src \u00FC/local.ts";
import esm,{kind as esmKind} from "fixture-esm"; import feature from "fixture-esm/feature"; import alias from "#fixture";
export const entryExport:number=9; const dynamicLocal=await import("./src \u00FC/dynamic.js"); const dynamicPackage=await import("fixture-esm");
const localCjs=require("./src \u00FC/common.cjs"),packageCjs=require("fixture-cjs"),conditionalRequire=require("fixture-esm"); await Bun.sleep(5);
console.log("PARITY_JSON:"+JSON.stringify({typed,localAwaited,esm,esmKind,feature,alias,dynamicLocal:dynamicLocal.value,dynamicPackage:dynamicPackage.default,localCjs:localCjs.value,packageCjs:packageCjs.value,conditionalRequire:conditionalRequire.value,entryExport}));'''},
'paths-unicode-space':{'code':r'''import {fileURLToPath} from "node:url"; import path from "node:path"; const m=await import("./src \u00FC/path module.js");
console.log("PARITY_JSON:"+JSON.stringify({cwd:process.cwd(),dirname:__dirname,filename:__filename,filenameBase:path.basename(__filename),moduleBase:path.basename(fileURLToPath(m.url)),unicode:process.cwd().includes("\u00FC"),space:process.cwd().includes(" "),resolved:path.basename(require.resolve("fixture-cjs"))}));'''},
'stdout-stderr-spill':{'code':'console.log("PARITY_LONG_BEGIN:"+"L".repeat(5200)+":PARITY_LONG_END"); console.error("PARITY_STDERR_\u03A9");'},
'exception':{'code':'const n:number=7; throw new TypeError("PARITY_BOOM_\u03A9_"+n);'},
'timeout':{'code':'console.log("PARITY_TIMEOUT_STARTED"); await Bun.sleep(5000); console.log("PARITY_TIMEOUT_BAD");','timeoutSeconds':.25},
'images':{'code':f'''const b=Buffer.from("{PNG}","base64"); await Bun.write("tiny \u00FC image.png",b);
let invalid="";try{{await showImage(new Uint8Array([1,2,3]))}}catch(e){{invalid=String(e?.message||e)}}
await showImage("tiny \u00FC image.png"); await showImage(new Blob([b],{{type:"image/png"}})); await showImage(new Uint8Array(b)); await showImage(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
let fifth="";try{{await showImage(b)}}catch(e){{fifth=String(e?.message||e)}}
console.log("PARITY_JSON:"+JSON.stringify({{fifth,invalid}}));'''}}

def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def dump(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2,sort_keys=True,ensure_ascii=False)+'\n')
def fixtures(c):
 fs={'package.json':{'type':'module','imports':{'#fixture':'./hash target.js'}},'hash target.js':'export default "hash-import";','src \u00FC/local.ts':'export const typed:number=41; export const awaited=await Promise.resolve("local-tla");','src \u00FC/dynamic.js':'export const value="dynamic-local";','src \u00FC/common.cjs':'module.exports={value:"local-cjs"};','src \u00FC/path module.js':'export const url=import.meta.url;','node_modules/fixture-cjs/package.json':{'name':'fixture-cjs','version':'1.0.0','exports':'./index.cjs'},'node_modules/fixture-cjs/index.cjs':'module.exports={value:"package-cjs"};','node_modules/fixture-esm/package.json':{'name':'fixture-esm','version':'1.0.0','type':'module','exports':{'.':{'import':'./index.js','require':'./require.cjs'},'./feature':'./feature.js'}},'node_modules/fixture-esm/index.js':'export default "package-esm"; export const kind="esm";','node_modules/fixture-esm/feature.js':'export default "exports-feature";','node_modules/fixture-esm/require.cjs':'module.exports={value:"conditional-require"};'}
 for n,v in fs.items():
  p=c/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,separators=(',',':')) if isinstance(v,dict) else v)
def chat_tool(spec):
 args={'code':spec['code']};
 if 'timeoutSeconds'in spec:args['timeoutSeconds']=spec['timeoutSeconds']
 tc={'index':0,'id':'execute_parity_call','type':'function','function':{'name':'execute','arguments':json.dumps(args,ensure_ascii=False)}}
 es=[{'id':'chat','object':'chat.completion.chunk','created':1700000000,'model':MODEL,'choices':[{'index':0,'delta':{'role':'assistant','tool_calls':[tc]},'finish_reason':None}]},{'id':'chat','object':'chat.completion.chunk','created':1700000000,'model':MODEL,'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls'}]}]
 return ''.join('data: '+json.dumps(x,separators=(',',':'),ensure_ascii=False)+'\n\n'for x in es)+'data: [DONE]\n\n'
def response_tool(spec):
 args={'code':spec['code']};
 if 'timeoutSeconds'in spec:args['timeoutSeconds']=spec['timeoutSeconds']
 item={'type':'function_call','id':'fc_execute','call_id':'execute_parity_call','name':'execute','arguments':json.dumps(args,ensure_ascii=False)};resp={'id':'resp','object':'response','status':'completed','model':MODEL,'output':[item],'usage':{'input_tokens':1,'output_tokens':1,'input_tokens_details':{'cached_tokens':0}}}
 es=[{'type':'response.output_item.added','output_index':0,'item':item},{'type':'response.output_item.done','output_index':0,'item':item},{'type':'response.completed','response':resp}]
 return ''.join('event: '+x['type']+'\ndata: '+json.dumps(x,separators=(',',':'),ensure_ascii=False)+'\n\n'for x in es)
def final(path):
 if path.endswith('/responses'):
  i={'type':'message','id':'msg','role':'assistant','content':[{'type':'output_text','text':'EXECUTE_PARITY_DONE','annotations':[]}]};r={'id':'resp_final','object':'response','status':'completed','model':MODEL,'output':[i],'usage':{'input_tokens':1,'output_tokens':1,'input_tokens_details':{'cached_tokens':0}}};es=[{'type':'response.output_item.added','output_index':0,'item':i},{'type':'response.output_item.done','output_index':0,'item':i},{'type':'response.completed','response':r}]
  return ''.join('event: '+x['type']+'\ndata: '+json.dumps(x,separators=(',',':'))+'\n\n'for x in es)
 es=[{'id':'final','object':'chat.completion.chunk','created':1700000000,'model':MODEL,'choices':[{'index':0,'delta':{'role':'assistant','content':'EXECUTE_PARITY_DONE'},'finish_reason':None}]},{'id':'final','object':'chat.completion.chunk','created':1700000000,'model':MODEL,'choices':[{'index':0,'delta':{},'finish_reason':'stop'}]}]
 return ''.join('data: '+json.dumps(x,separators=(',',':'))+'\n\n'for x in es)+'data: [DONE]\n\n'
def compact(v):
 if isinstance(v,list):return[compact(x)for x in v]
 if isinstance(v,dict):
  o={}
  for k,x in v.items():
   if k in('data','b64_json')and isinstance(x,str)and len(x)>40:
    try:b=base64.b64decode(x,validate=True);o[k]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
    except:o[k]='<invalid-base64>'
   elif k in('url','image_url')and isinstance(x,str)and x.startswith('data:image/'):
    h,d=x.split(',',1);b=base64.b64decode(d);o[k]={'mime':h.split(';')[0][5:],'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
   else:o[k]=compact(x)
  return o
 return v
def image_records(v):
 out=[]
 def walk(x):
  if isinstance(x,str)and x.startswith('{'):
   try:walk(json.loads(x))
   except:pass
  elif isinstance(x,dict):
   data=x.get('data');mime=x.get('mimeType')or x.get('mime_type')
   if isinstance(data,str)and isinstance(mime,str)and mime.startswith('image/'):
    try:b=base64.b64decode(data,validate=True);out.append({'mime':mime,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
    except:out.append({'mime':mime,'error':'invalid-base64'})
   u=x.get('image_url')or(x.get('url')if x.get('type') in('image_url','input_image')else None)
   if isinstance(u,dict):u=u.get('url')
   if isinstance(u,str)and u.startswith('data:image/'):
    h,d=u.split(',',1);b=base64.b64decode(d);out.append({'mime':h.split(';')[0][5:],'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
   for y in x.values():walk(y)
  elif isinstance(x,list):
   for y in x:walk(y)
 walk(v);return out
def outputs(body):
 out=[]
 def walk(v):
  if isinstance(v,dict):
   if v.get('role')=='tool':out.append({'kind':'tool-message','value':compact(v.get('content'))})
   if v.get('type')=='function_call_output':out.append({'kind':'function-call-output','value':compact(v.get('output'))})
   for x in v.values():walk(x)
  elif isinstance(v,list):
   for x in v:walk(x)
 walk(body);return out
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):
 daemon_threads=True
 def __init__(self,spec,log):self.spec=spec;self.log=log;self.seen=[];self.lock=threading.Lock();super().__init__(('127.0.0.1',0),Handler)
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_POST(self):
  try:body=json.loads(self.rfile.read(int(self.headers.get('content-length','0'))))
  except:body={}
  with self.server.lock:
   n=len(self.server.seen)+1;self.server.seen.append({'ordinal':n,'path':self.path,'tool_outputs':outputs(body),'images':image_records(body),'top_level_keys':sorted(body)if isinstance(body,dict)else[]});dump(self.server.log,self.server.seen)
  if n>2:text=json.dumps({'error':{'message':'request budget exceeded'}});status=429;ctype='application/json'
  else:text=(response_tool(self.server.spec)if self.path.endswith('/responses')else chat_tool(self.server.spec))if n==1 else final(self.path);status=200;ctype='text/event-stream'
  b=text.encode();self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
def env(home,tmp):
 e={'HOME':str(home),'TMPDIR':str(tmp),'PATH':os.environ.get('PATH','/usr/bin:/bin'),'NO_COLOR':'1','CI':'1','OPENAI_API_KEY':KEY}
 for k in('LANG','LC_ALL'):
  if k in os.environ:e[k]=os.environ[k]
 return e
def config(home,port):
 c={'providers':{'parity':{'baseUrl':f'http://127.0.0.1:{port}/v1','api':'openai-completions','apiKey':KEY,'models':[{'id':MODEL,'name':'parity','contextWindow':32000,'maxTokens':1000,'input':['text','image'],'output':['text']}]}}}
 for d in(home/'.die'/'agent',home/'.godie'/'agent'):d.mkdir(parents=True,exist_ok=True);dump(d/'models.json',c)
def strings(v):
 if isinstance(v,str):yield v
 elif isinstance(v,list):
  for x in v:yield from strings(x)
 elif isinstance(v,dict):
  for x in v.values():yield from strings(x)
def semantics(req,temp):
 out=req[-1]['tool_outputs']if len(req)>=2 else[];expanded=[]
 def expand(v):
  if isinstance(v,str)and v.startswith('{'):
   try:expanded.append(compact(json.loads(v)))
   except:pass
  elif isinstance(v,(list,dict)):
   for x in(v.values()if isinstance(v,dict)else v):expand(x)
 expand(out);combined=[out,*expanded];text='\n'.join(strings(combined)).replace(str(temp),'<TEMP>');text=re.sub(r'<TEMP>/(?:original|candidate)/[^/]+','<TEMP>',text);vals=[]
 for m in re.finditer(r'PARITY_JSON:(\{[^\n]*\})',text):
  try:vals.append(json.loads(m.group(1)))
  except:pass
 imgs=[]
 def find(v):
  if isinstance(v,dict):
   for x in v.values():
    if isinstance(x,dict)and'sha256'in x:imgs.append(x)
    else:find(x)
  elif isinstance(v,list):
   for x in v:find(x)
 find(combined);imgs=req[-1].get('images',imgs)if req else imgs;marks={x:x in text for x in['PARITY_LONG_BEGIN','PARITY_LONG_END','PARITY_STDERR_\u03A9','PARITY_BOOM_\u03A9_7','PARITY_TIMEOUT_STARTED','PARITY_TIMEOUT_BAD','timed out','timeout']}
 return{'parity_json':vals,'markers':marks,'images':imgs,'text_excerpt':text[-1600:]}
def run(binary,label,name,spec,out,temp):
 d=out/label/name;d.mkdir(parents=True,exist_ok=True);home=temp/label/name/'home';tmp=temp/label/name/'tmp';cwd=temp/label/name/'workspace \u00FC space'
 for x in(home,tmp,cwd):x.mkdir(parents=True,exist_ok=True)
 fixtures(cwd);srv=Server(spec,d/'requests.semantic.json');threading.Thread(target=srv.serve_forever,daemon=True).start();port=srv.server_address[1];config(home,port)
 cmd=[str(binary),'--no-session','--provider']+(['parity','--model',MODEL,'-p','execute-parity']if label=='original'else['openai','--model',MODEL,'--api-key',KEY,'--base-url',f'http://127.0.0.1:{port}/v1','-p','execute-parity']);start=time.monotonic();timed=False;p=subprocess.Popen(cmd,cwd=cwd,env=env(home,tmp),stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 try:so,se=p.communicate(timeout=12)
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
 (d/'stdout.raw').write_bytes(so);(d/'stderr.raw').write_bytes(se);r={'scenario':name,'exit_code':p.returncode,'harness_timed_out':timed,'duration_ms':round((time.monotonic()-start)*1000),'request_count':len(srv.seen),'request_budget':2,'semantic':semantics(srv.seen,temp),'stdout':so.decode(errors='replace'),'stderr':se.decode(errors='replace'),'cleanup':{'process_group':p.pid,'method':'natural exit'if not timed else'SIGTERM then SIGKILL only if needed'}};dump(d/'result.json',r);return r
def compare(name,a,b):
 why=[];sa=a['semantic'];sb=b['semantic']
 if a['harness_timed_out']or b['harness_timed_out']:why+=['outer harness timeout']
 if a['request_count']!=2 or b['request_count']!=2:why+=['not exactly two provider requests']
 if name in('language-modules','paths-unicode-space','images')and sa['parity_json']!=sb['parity_json']:why+=['PARITY_JSON differs']
 if name=='images'and sa['images']!=sb['images']:why+=['image count/hash differs']
 if name=='stdout-stderr-spill':
  for m in('PARITY_LONG_END','PARITY_STDERR_\u03A9'):
   if not sa['markers'][m]or not sb['markers'][m]:why+=[m+' missing']
 if name=='exception'and(not sa['markers']['PARITY_BOOM_\u03A9_7']or not sb['markers']['PARITY_BOOM_\u03A9_7']):why+=['exception message missing']
 if name=='timeout':
  for s,l in((sa,'original'),(sb,'candidate')):
   if not(s['markers']['timed out']or s['markers']['timeout']):why+=[l+' timeout diagnostic missing']
   if s['markers']['PARITY_TIMEOUT_BAD']:why+=[l+' continued after timeout']
 return{'status':'DIFF'if why else'MATCH','reasons':why}
def main():
 p=argparse.ArgumentParser();p.add_argument('--original',type=pathlib.Path,default=ROOT/'expt-go'/'bin'/'die-original');p.add_argument('--candidate',type=pathlib.Path,default=ROOT/'expt-go'/'bin'/'godie');p.add_argument('--output',type=pathlib.Path,default=DEFAULT);a=p.parse_args();out=a.output.resolve();allowed=(ROOT/'artifacts').resolve()
 if allowed not in out.parents or not out.name.startswith('execute-parity-'):raise SystemExit('output must be artifacts/execute-parity-*')
 shutil.rmtree(out,ignore_errors=True);out.mkdir(parents=True);orig=a.original.resolve();active=a.candidate.resolve()
 for x in(orig,active):
  if not(x.is_file()and os.access(x,os.X_OK)):raise SystemExit('not executable: '+str(x))
 snap=out/'candidate-snapshot';shutil.copy2(active,snap);snap.chmod(0o755);temp=pathlib.Path(tempfile.mkdtemp(prefix='execute-parity-'));rs={'original':{},'candidate':{}}
 try:
  for label,binary in(('original',orig),('candidate',snap)):
   for n,s in SCENARIOS.items():rs[label][n]=run(binary,label,n,s,out,temp)
  cs={n:compare(n,rs['original'][n],rs['candidate'][n])for n in SCENARIOS};dump(out/'manifest.json',{'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'original':str(orig),'original_sha256':sha(orig),'candidate_active_source':str(active),'candidate_snapshot':str(snap),'candidate_sha256':sha(snap),'candidate_snapshot_matches_active_at_copy':sha(snap)==sha(active),'internet_used':False,'real_credentials_used':False,'provider_requests_max_per_process':2,'same_code_inputs':True,'transport_compared_as_bytes':False,'comparisons':cs});print(out);print(json.dumps(cs,indent=2))
 finally:shutil.rmtree(temp,ignore_errors=True)
if __name__=='__main__':main()
