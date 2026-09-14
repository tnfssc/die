#!/usr/bin/env python3
"""Bounded, credential-free executable CLI evidence. Never resolves die on PATH."""
import os,sys,tempfile,subprocess,json,hashlib,pathlib
binary=os.path.realpath(sys.argv[1]); evidence=pathlib.Path(sys.argv[2]);evidence.mkdir(parents=True,exist_ok=True)
assert os.path.isfile(binary)
root=pathlib.Path(tempfile.mkdtemp(prefix='godie-cli-probe-'))
results=[]
for index,args in enumerate([['--version'],['--help'],['--no-tools'],['--tools=read'],['update']]):
 home=root/str(index);home.mkdir(mode=0o700);tmp=home/'tmp';tmp.mkdir();work=home/'work';work.mkdir()
 env={'HOME':str(home),'TMPDIR':str(tmp),'PATH':'/nonexistent','LANG':'C.UTF-8','TERM':'dumb','HERDR_ENV':'0','DIE_CODING_AGENT_DIR':str(home/'agent'),'DIE_CODING_AGENT_SESSION_DIR':str(home/'sessions'),'GODIE_STATE_DIR':str(home/'godie')}
 try:
  p=subprocess.run([binary]+args,cwd=work,env=env,capture_output=True,timeout=20)
  row={'args':args,'exitCode':p.returncode,'stdout':p.stdout.decode(errors='replace'),'stderr':p.stderr.decode(errors='replace')}
 except subprocess.TimeoutExpired:row={'args':args,'timeout':True}
 row['files']=[str(p.relative_to(home)) for p in home.rglob('*') if p.is_file() and 'auth' not in p.name]
 results.append(row)
report={'binary':binary,'sha256':hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),'isolatedRoot':str(root),'results':results}
(evidence/'cli.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'evidence':str(evidence/'cli.json'),'cases':len(results),'exits':[r.get('exitCode') for r in results]}))
