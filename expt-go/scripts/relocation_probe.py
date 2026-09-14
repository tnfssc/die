#!/usr/bin/env python3
import pathlib,sys,tempfile,subprocess,os,json,shutil,hashlib,time
binary=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
root=pathlib.Path(tempfile.mkdtemp(prefix='godie-relocated-'));home=root/'home';work=root/'unicode space 界';home.mkdir();work.mkdir();target=work/'assistant';shutil.copyfile(binary,target);target.chmod(0o700)
env={'HOME':str(home),'TMPDIR':str(root),'GODIE_STATE_DIR':str(home/'.godie'),'PATH':'/nonexistent','LANG':'C.UTF-8','HERDR_ENV':'0'}
code='const start=Date.now(); const results=await Promise.all(Array.from({length:50},()=>shell("/bin/sleep .1; printf ok",{waitSeconds:3}))); const list=await jobs.list({count:100}); console.log(JSON.stringify({count:results.length,completed:results.filter(x=>x.status==="completed"&&x.exitCode===0).length,foreground:results.filter(x=>x.background===false).length,records:list.jobs.length,running:list.jobs.filter(x=>x.status==="running").length,elapsedMs:Date.now()-start,filename:__filename,dirname:__dirname,bun:typeof Bun.version}));'
try:
 start=time.monotonic();r=subprocess.run([str(target),'--offline','--execute',code],cwd=work,env=env,capture_output=True,text=True,timeout=30,start_new_session=True)
 result=json.loads(r.stdout);facts=json.loads(result.get('output','{}'))
 passed=r.returncode==0 and result.get('exitCode')==0 and facts.get('count')==50 and facts.get('completed')==50 and facts.get('foreground')==50 and facts.get('records')==50 and facts.get('running')==0 and facts.get('bun')=='string'
 manifest={'status':'PASS' if passed else 'FAIL','binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'bytes':binary.stat().st_size,'elapsedSeconds':time.monotonic()-start,'PATH':env['PATH'],'copiedBinaryOnly':True,'exitCode':r.returncode,'facts':facts,'stderr':r.stderr,'runtimeAssets':[str(x.relative_to(home)) for x in home.rglob('bun')],'internetUsed':False}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))
finally:shutil.rmtree(root)
