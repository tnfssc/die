#!/usr/bin/env python3
"""Corrupt only a temporary ELF copy's embedded gzip; source/release bytes untouched."""
import pathlib,sys,tempfile,subprocess,json,shutil,hashlib
binary=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);gz=(pathlib.Path(__file__).resolve().parents[1]/'internal/runtime/assets/bun-linux-amd64.gz').read_bytes();original=binary.read_bytes();offset=original.find(gz)
if offset<0:raise SystemExit('embedded gzip bytes not found; no patch performed')
root=pathlib.Path(tempfile.mkdtemp(prefix='godie-corrupt-payload-'));target=root/'corrupted-candidate';state=root/'state';home=root/'home';home.mkdir();data=bytearray(original);index=offset+len(gz)//2;data[index]^=1;target.write_bytes(data);target.chmod(0o700)
try:
 env={'HOME':str(home),'GODIE_STATE_DIR':str(state),'TMPDIR':str(root),'PATH':'/nonexistent','LANG':'C.UTF-8','HERDR_ENV':'0'}
 p=subprocess.run([str(target),'--offline','--execute','console.log("CORRUPT_MUST_NOT_RUN")'],cwd=root,env=env,capture_output=True,text=True,timeout=20,start_new_session=True)
 executable=list(state.rglob('bun'));passed=p.returncode!=0 and 'CORRUPT_MUST_NOT_RUN' not in p.stdout and not executable
 m={'status':'PASS' if passed else 'FAIL','sourceBinarySHA256':hashlib.sha256(original).hexdigest(),'patchedBinarySHA256':hashlib.sha256(data).hexdigest(),'patchedByteOffset':index,'embeddedGzipOffset':offset,'embeddedGzipBytes':len(gz),'exitCode':p.returncode,'stdout':p.stdout,'stderr':p.stderr,'bunPublished':bool(executable),'sourceBinaryUnchanged':hashlib.sha256(binary.read_bytes()).hexdigest()==hashlib.sha256(original).hexdigest(),'internetUsed':False};(out/'manifest.json').write_text(json.dumps(m,indent=2));print(json.dumps(m,indent=2))
finally:shutil.rmtree(root)
