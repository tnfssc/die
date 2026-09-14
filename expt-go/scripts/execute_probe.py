#!/usr/bin/env python3
import os,sys,json,tempfile,pathlib,subprocess,time,hashlib
binary=str(pathlib.Path(sys.argv[1]).resolve());out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);root=pathlib.Path(tempfile.mkdtemp(prefix='godie-execute-'));home=root/'home';home.mkdir();work=root/'work';work.mkdir();tmp=root/'tmp';tmp.mkdir()
env={'HOME':str(home),'TMPDIR':str(tmp),'PATH':'/nonexistent','LANG':'C.UTF-8','HERDR_ENV':'0','GODIE_STATE_DIR':str(root/'state')}
(work/'local.ts').write_text('export const n: number = 42;');(work/'package.json').write_text('{"type":"module"}')
scenarios={'ts-local':'import { n } from "./local.ts"; const answer: number = await Promise.resolve(n); console.log("ANSWER", answer, typeof Bun.file, typeof require("node:fs").readFileSync);', '50-jobs':'const launched = await Promise.all(Array.from({length:50}, (_, i) => shell("printf job_"+i, {waitSeconds:0}))); await Bun.sleep(1200); console.log(JSON.stringify(await jobs.list({count:100})));', 'history-goal':'console.log(await goal.set({objective:"test objective",criteria:["deterministic"],constraints:[]})); console.log(await goal.get()); console.log(await history.search({query:"test"}));', 'handoff':'console.log("before"); await handoff("yielded"); console.log("AFTER_SHOULD_NOT_RUN");'}
results=[]
for name,code in scenarios.items():
 start=time.monotonic();p=subprocess.run([binary,'--offline','--execute',code],cwd=work,env=env,capture_output=True,timeout=30)
 text=p.stdout.decode(errors='replace');err=p.stderr.decode(errors='replace');(out/(name+'.stdout')).write_text(text);(out/(name+'.stderr')).write_text(err)
 try:value=json.loads(text)
 except:value={}
 row={'scenario':name,'exitCode':p.returncode,'seconds':time.monotonic()-start,'executeExitCode':value.get('exitCode'),'handoff':value.get('handoff'),'outputBytes':len(text)}
 if name=='50-jobs':
  try:j=json.loads(value['output']);row['jobs']=len(j['jobs']);row['completed']=sum(x['status']=='completed' for x in j['jobs'])
  except:pass
 results.append(row)
report={'binarySHA256':hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),'root':str(root),'path':'/nonexistent','results':results};(out/'manifest.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
