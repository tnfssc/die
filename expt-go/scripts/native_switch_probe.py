#!/usr/bin/env python3
"""Bounded real native-SSE CLI restart/provenance probe; only loopback/dummy auth."""
import argparse, pathlib, tempfile, threading, http.server, json, subprocess, os, hashlib, shutil
ap=argparse.ArgumentParser();ap.add_argument('binary',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);args=ap.parse_args();binary=args.binary.resolve();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
seen=[]
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));seen.append({'path':self.path,'body':body})
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  def event(t,data):self.wfile.write(('event: '+t+'\ndata: '+json.dumps(data)+'\n\n').encode())
  if self.path.endswith('/messages'):
   event('message_start',{'type':'message_start','message':{'id':'anthropic-native-id','usage':{'input_tokens':10,'output_tokens':0}}})
   event('content_block_start',{'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}})
   event('content_block_delta',{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'ANTHROPIC_PERSISTED'}})
   event('content_block_stop',{'type':'content_block_stop','index':0})
   event('message_delta',{'type':'message_delta','delta':{'stop_reason':'end_turn'},'usage':{'output_tokens':4}})
   event('message_stop',{'type':'message_stop'})
  else:
   text='OPENAI_PERSISTED' if len(seen)==1 else 'OPENAI_RETURNED'
   items=[{'id':'reasoning-openai-only','type':'reasoning','encrypted_content':'OPAQUE_OPENAI_STATE','summary':[]},{'id':'msg-fixture','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':text,'annotations':[]}]}]
   event('response.output_text.delta',{'type':'response.output_text.delta','delta':text})
   event('response.completed',{'type':'response.completed','response':{'id':'resp-fixture','status':'completed','output':items,'usage':{'input_tokens':10,'output_tokens':4}}})
  self.wfile.flush()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
root=pathlib.Path(tempfile.mkdtemp(prefix='godie-native-switch-'));home=root/'home';cwd=root/'work';home.mkdir();cwd.mkdir();state=home/'.godie'
env={k:v for k,v in os.environ.items() if not any(x in k.upper() for x in ['API_KEY','TOKEN','AUTH','HERDR','DIE_','GODIE_'])};env.update(HOME=str(home),TMPDIR=str(root),NO_COLOR='1')
results=[]
try:
 for index,kind in enumerate(['openai','anthropic','openai']):
  cmd=[str(binary),'--state-dir',str(state),'--cwd',str(cwd),'--provider',kind,'--model','fixture','--api-key','dummy-local-only','--base-url','http://127.0.0.1:'+str(server.server_port),'--thinking','medium','-p','native fixture '+str(index)]
  if index:cmd+=['--continue']
  r=subprocess.run(cmd,cwd=cwd,env=env,capture_output=True,text=True,timeout=12,start_new_session=True)
  results.append({'provider':kind,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
 files=list((state/'sessions').glob('*.jsonl'));records=[json.loads(line) for line in files[0].read_text().splitlines()] if len(files)==1 else []
 assistants=[r['message'] for r in records if r.get('message',{}).get('role')=='assistant']
 provenance=[m.get('provider') for m in assistants]
 nativeArchive='OPAQUE_OPENAI_STATE' in json.dumps(records)
 anthropic=json.dumps(seen[1]['body']) if len(seen)>1 else ''
 nativeNotForwarded='OPAQUE_OPENAI_STATE' not in anthropic and 'reasoning-openai-only' not in anthropic
 oldTextForwarded='OPENAI_PERSISTED' in anthropic
 thinking=seen[1]['body'].get('thinking',{}) if len(seen)>1 else {}
 passed=all(r['exitCode']==0 for r in results) and len(seen)==3 and provenance==['openai','anthropic','openai'] and nativeArchive and nativeNotForwarded and oldTextForwarded and thinking.get('type')=='enabled'
 manifest={'status':'PASS' if passed else 'FAIL','binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'internetUsed':False,'realCredentialsUsed':False,'processes':results,'requests':len(seen),'assistantProvenance':provenance,'archiveRetainsOpenAINative':nativeArchive,'foreignOpaqueNotForwarded':nativeNotForwarded,'portableTextForwarded':oldTextForwarded,'anthropicThinking':thinking,'sessions':len(files)}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2));(out/'requests.json').write_text(json.dumps(seen,indent=2));print(json.dumps(manifest,indent=2))
finally:server.shutdown();server.server_close();shutil.rmtree(root)
