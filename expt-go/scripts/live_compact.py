#!/usr/bin/env python3
import os,sys,pathlib,json,tempfile,subprocess,hashlib,signal
assert os.environ.get('GODIE_LIVE_PROBE')=='1'
base=pathlib.Path(sys.argv[1]).resolve();candidate=pathlib.Path(sys.argv[2]).resolve();out=pathlib.Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
source=pathlib.Path.home()/'.die/agent/auth.json';original=source.read_bytes();cred=json.loads(original)['openai-codex'];secret=[v for v in cred.values() if isinstance(v,str) and len(v)>20];root=pathlib.Path(tempfile.mkdtemp(prefix='godie-live-compact-'));results=[]
try:
 for side,binary,manifest in [('original',base,'expt-go/evidence/live-tool/manifest.json'),('candidate',candidate,'expt-go/evidence/live-tool-fixed/manifest.json')]:
  prior=pathlib.Path(json.loads(pathlib.Path(manifest).read_text())['isolatedRoot'])/side
  sources=[p for p in prior.rglob('*.jsonl') if not p.name.endswith('.jobs.jsonl') and p.is_file()]
  assert len(sources)==1,(side,len(sources))
  home=root/side;home.mkdir();state=home/'state';state.mkdir(mode=0o700);work=home/'work';work.mkdir();tmp=home/'tmp';tmp.mkdir();session=home/'fixture.jsonl';session.write_bytes(sources[0].read_bytes());(state/'auth.json').write_text(json.dumps({'openai-codex':cred}));os.chmod(state/'auth.json',0o600)
  env={'HOME':str(home),'TMPDIR':str(tmp),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TERM':'dumb','HERDR_ENV':'0','DIE_CODING_AGENT_DIR':str(state),'DIE_CODING_AGENT_SESSION_DIR':str(home/'sessions'),'GODIE_STATE_DIR':str(state)}
  args=[str(binary),'-p','--mode','json','--provider','openai-codex','--model','gpt-5.6-luna','--thinking','low','--session',str(session),'/compact']
  p=subprocess.Popen(args,cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  try:stdout,stderr=p.communicate(timeout=75)
  except subprocess.TimeoutExpired:
   p.terminate()
   try:stdout,stderr=p.communicate(timeout=12)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);stdout,stderr=p.communicate(timeout=5)
  for name,data in [('stdout',stdout),('stderr',stderr)]:
   text=data.decode(errors='replace')
   for value in secret:text=text.replace(value,'[REDACTED]')
   (out/(side+'.'+name)).write_text(text)
  rows=[json.loads(line) for line in session.read_text().splitlines()]
  checkpoint=[r for r in rows if r.get('type')=='compaction' or r.get('customType')=='die-compaction']
  results.append({'side':side,'exitCode':p.returncode,'checkpointRecords':len(checkpoint),'checkpointTypes':[r.get('type')+':'+r.get('customType','') for r in checkpoint],'sessionBytes':session.stat().st_size,'binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest()})
  (state/'auth.json').unlink()
finally:
 for p in root.rglob('auth.json'):p.unlink()
 report={'model':'gpt-5.6-luna','standardTier':True,'budget':'one explicit compaction per implementation, 75s deadline; no fallback/retry by harness','root':str(root),'sourceAuthUnchanged':source.read_bytes()==original,'results':results};(out/'manifest.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
