#!/usr/bin/env python3
import pathlib,sys,tempfile,subprocess,json,shutil,hashlib
binary=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);root=pathlib.Path(tempfile.mkdtemp(prefix='godie-product-'));home=root/'home';work=root/'work';home.mkdir();work.mkdir();state=home/'.godie';sid='12345678-1234-1234-1234-123456789abc';results=[]
env={'HOME':str(home),'TMPDIR':str(root),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HERDR_ENV':'0'}
commands=[('/goal set build fixture --criteria marker; tests --constraints no network','Goal: build fixture'),('/goal pause waiting','paused'),('/goal resume','active'),('/goal clear','No goal is set.'),('/cache-ttl 30m','30m'),('/cache-ttl','30m'),('/mode orchestrator','orchestrator'),('/session',sid),('/tree','custom'),('/memory status',''),('/diagnostics durable','durableScan'),('/history search build',''),('/export '+str(root/'session.html'),'Exported session'),('/help','/session')]
try:
 for cmd,marker in commands:
  p=subprocess.run([str(binary),'--offline','--state-dir',str(state),'--cwd',str(work),'--session-id',sid,'--command',cmd],cwd=work,env=env,capture_output=True,text=True,timeout=12,start_new_session=True)
  results.append({'command':cmd.replace(str(root),'<TEMP>'),'exitCode':p.returncode,'stdout':p.stdout.replace(str(root),'<TEMP>'),'stderr':p.stderr,'status':'PASS' if p.returncode==0 and marker in p.stdout else 'FAIL'})
 records=[json.loads(l) for l in (state/'sessions'/(sid+'.jsonl')).read_text().splitlines()];exact=records[0]['id']==sid
 exported=(root/'session.html').is_file()
 manifest={'status':'PASS' if all(r['status']=='PASS' for r in results) and exact and exported else 'FAIL','binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'internetUsed':False,'exactSessionID':exact,'HTMLExportExists':exported,'processCount':len(results),'results':results};(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))
finally:shutil.rmtree(root)
