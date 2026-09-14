#!/usr/bin/env python3
"""Explicit bounded standard-tier Codex differential probe; never archives auth."""
import os,sys,tempfile,subprocess,json,pathlib,hashlib,shutil,signal
assert os.environ.get('GODIE_LIVE_PROBE')=='1','explicit opt-in required'
base=pathlib.Path(sys.argv[1]).resolve(); candidate=pathlib.Path(sys.argv[2]).resolve(); evidence=pathlib.Path(sys.argv[3]);evidence.mkdir(parents=True,exist_ok=True)
scenario=sys.argv[4] if len(sys.argv)>4 else 'greeting'
source=pathlib.Path.home()/'.die/agent/auth.json';original=source.read_bytes();auth=json.loads(original);cred=auth['openai-codex'];secrets=[v for v in cred.values() if isinstance(v,str) and len(v)>20]
root=pathlib.Path(tempfile.mkdtemp(prefix='godie-live-probe-'));os.chmod(root,0o700)
prompts={'greeting':'Reply with exactly GODIE_LIVE_OK. Do not call any tool.', 'tool':'Call execute exactly once with this TypeScript code: const n: number = 21; console.log("GODIE_TOOL_" + n*2); Then reply only with the printed value. No other tools or jobs.', 'background':'Call execute with: const job = await shell("sleep 1; printf GODIE_BACKGROUND_OK", {waitSeconds:0}); console.log(job); await handoff("waiting for background"); After completion reply only GODIE_BACKGROUND_OK. Do not launch any other work.'}
prompts['child']='Call execute exactly once with: const child = await subagent({type:"fast", prompt:"Reply exactly CHILD_OK. Do not call tools.", waitSeconds:20, timeoutSeconds:45}); console.log(child); Then reply exactly CHILD_OK. Do not launch any other work.'
assert scenario in prompts
results=[]
try:
 for side,binary in [('original',base),('candidate',candidate)]:
  if os.environ.get('GODIE_LIVE_SIDE') and side != os.environ['GODIE_LIVE_SIDE']: continue
  home=root/side;home.mkdir(mode=0o700);work=home/'work';work.mkdir();tmp=home/'tmp';tmp.mkdir();state=home/'state';state.mkdir(mode=0o700);(state/'auth.json').write_text(json.dumps({'openai-codex':cred}));os.chmod(state/'auth.json',0o600)
  env={'HOME':str(home),'TMPDIR':str(tmp),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TERM':'dumb','HERDR_ENV':'0','DIE_CODING_AGENT_DIR':str(state),'DIE_CODING_AGENT_SESSION_DIR':str(home/'sessions'),'GODIE_STATE_DIR':str(state)}
  args=[str(binary),'-p','--mode','json','--provider','openai-codex','--model','gpt-5.6-luna','--thinking','low']
  if side=='candidate':args+=['--max-turns','4','--max-tokens','0']
  args += [prompts[scenario]]
  try:
   proc=subprocess.Popen(args,cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
   try: stdout,stderr=proc.communicate(timeout=75)
   except subprocess.TimeoutExpired:
    proc.terminate()
    try: proc.communicate(timeout=12)
    except subprocess.TimeoutExpired: os.killpg(proc.pid,signal.SIGKILL);proc.communicate(timeout=5)
    raise
   p=subprocess.CompletedProcess(args,proc.returncode,stdout,stderr)
   output=p.stdout.decode(errors='replace');error=p.stderr.decode(errors='replace')
   for secret in secrets:output=output.replace(secret,'[REDACTED]');error=error.replace(secret,'[REDACTED]')
   # Synthetic prompt/session only; raw HTTP or auth files are never copied.
   (evidence/(side+'.stdout')).write_text(output);(evidence/(side+'.stderr')).write_text(error)
   rows=[]
   for line in output.splitlines():
    try:rows.append(json.loads(line))
    except:pass
   assistant=[r.get('message',{}) for r in rows if r.get('type')=='message_end' and r.get('message',{}).get('role')=='assistant'] if side=='original' else [r.get('data',{}) for r in rows if r.get('type')=='message']
   final=assistant[-1] if assistant else {}
   content=final.get('content',''); finaltext=''.join(x.get('text','') for x in content if x.get('type')=='text') if isinstance(content,list) else content
   tools=sum(r.get('type') in ['tool_execution_start','tool_start'] for r in rows)
   results.append({'side':side,'finalText':finaltext[:1000],'toolCalls':tools,'assistantPersisted':bool(finaltext or final.get('toolCalls')),'stopReason':final.get('stopReason'),'exitCode':p.returncode,'eventTypes':[r.get('type') for r in rows],'stdoutBytes':len(p.stdout),'stderrBytes':len(p.stderr),'containsMarker':'GODIE_' in output,'binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest()})
  except subprocess.TimeoutExpired:
   results.append({'side':side,'timeout':True})
  finally:
   (state/'auth.json').unlink(missing_ok=True)
finally:
 unchanged=source.read_bytes()==original
 report={'scenario':scenario,'model':'gpt-5.6-luna','tier':'default/standard; no fast flags','budget':'2 app invocations, candidate max 4 turns; Codex wire output cap unsupported, 75s each; no retries by harness','sourceAuthUnchanged':unchanged,'isolatedRoot':str(root),'results':results}
 (evidence/'manifest.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
 for p in root.rglob('auth.json'):p.unlink()
 assert unchanged,'real auth changed'
