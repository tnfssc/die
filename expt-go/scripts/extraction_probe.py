#!/usr/bin/env python3
import pathlib,sys,tempfile,subprocess,os,json,shutil,hashlib,time,concurrent.futures,signal
binary=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);root=pathlib.Path(tempfile.mkdtemp(prefix='godie-extraction-'));home=root/'home';home.mkdir();work=root/'work';work.mkdir()
def env(state):return {'HOME':str(home),'TMPDIR':str(root),'GODIE_STATE_DIR':str(state),'PATH':'/nonexistent','LANG':'C.UTF-8','HERDR_ENV':'0'}
def run(state):
 r=subprocess.run([str(binary),'--offline','--no-session','--execute','console.log("EXTRACT_OK")'],cwd=work,env=env(state),capture_output=True,text=True,timeout=20,start_new_session=True)
 return {'exitCode':r.returncode,'marker':'EXTRACT_OK' in r.stdout,'stderr':r.stderr}
try:
 shared=root/'shared'
 with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:parallel=list(pool.map(lambda _:run(shared),range(16)))
 second=run(shared);bun=next(shared.rglob('bun'));expected=hashlib.sha256(bun.read_bytes()).hexdigest();bun.write_bytes(b'corrupted');corrupt=run(shared);corrupt['hashRestored']=hashlib.sha256(bun.read_bytes()).hexdigest()==expected
 crashState=root/'crash';p=subprocess.Popen([str(binary),'--offline','--no-session','--execute','console.log("EXTRACT_OK")'],cwd=work,env=env(crashState),stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 deadline=time.monotonic()+5;interrupted=False
 while time.monotonic()<deadline and p.poll() is None:
  if list(crashState.rglob('.bun-*')):os.killpg(p.pid,signal.SIGKILL);interrupted=True;break
  time.sleep(.001)
 p.communicate(timeout=5);recovery=run(crashState)
 cacheRoot=bun.parent
 for f in cacheRoot.rglob('*'):
  if f.is_file():f.chmod(0o500)
 cacheRoot.chmod(0o500);readonly=run(shared);cacheRoot.chmod(0o700)
 results={'parallel16':parallel,'secondLaunch':second,'corruptRecovery':corrupt,'interruptedDuringExtraction':interrupted,'crashRecovery':recovery,'readOnlyCache':readonly}
 passed=all(x['exitCode']==0 and x['marker'] for x in parallel+[second,corrupt,recovery,readonly]) and corrupt['hashRestored'] and interrupted
 manifest={'status':'PASS' if passed else 'FAIL','binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'internetUsed':False,'results':results};(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))
finally:
 for p in root.rglob('*'):
  try:
   if p.is_dir():p.chmod(0o700)
  except OSError:pass
 shutil.rmtree(root)
