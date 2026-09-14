#!/usr/bin/env python3
"""Collect only local pinned public license inputs; no download or installation."""
import pathlib,subprocess,json,re
root=pathlib.Path(__file__).resolve().parents[1]
data=subprocess.check_output(['go','list','-m','-json','all'],cwd=root,text=True);dec=json.JSONDecoder();modules=[]
while data.strip():
 data=data.lstrip();obj,n=dec.raw_decode(data);modules.append(obj);data=data[n:]
used=set(subprocess.check_output(['go','list','-deps','-f','{{if .Module}}{{.Module.Path}}{{end}}','./cmd/godie'],cwd=root,text=True).splitlines())
sections=['Godie third-party notices (development build)\n\nBun is a separately executed bundled runtime, not an application wrapper. This collection does not resolve LGPL source/relinking obligations; release legal review remains required.\n']
def add(label,path):
 if not path.is_file():return False
 b=path.read_bytes();assert len(b)<=1024*1024,path
 sections.append('\n'+'='*72+'\n'+label+'\n'+'='*72+'\n'+b.decode(errors='replace')+'\n');return True
add('Godie / Die MIT license',root.parent/'LICENSE')
add('Pi 0.85.0 license (model catalog source attribution)',root.parent/'third_party/pi/LICENSE')
add('Bun 1.4.1 runtime and linked-library notice',root.parent/'third_party/bun/LICENSE.md')
add('Photon 0.3.4',root/'internal/runtime/assets/photon/LICENSE.md')
gopath=pathlib.Path(subprocess.check_output(['go','env','GOROOT'],cwd=root,text=True).strip());add('Go standard library',gopath/'LICENSE')
missing=[]
for m in modules:
 if m.get('Main') or m['Path'] not in used:continue
 d=pathlib.Path(m.get('Dir','/nonexistent'));files=sorted(p for p in d.iterdir() if p.is_file() and re.match(r'^(licen[cs]e|copying|notice)([._-].*)?$',p.name,re.I)) if d.is_dir() else []
 if not files:missing.append(m['Path']+' '+m.get('Version',''));continue
 for p in files:add(m['Path']+' '+m.get('Version','')+' / '+p.name,p)
sections.append('\nModules without a root notice found (requires review):\n'+'\n'.join(missing)+'\n')
out=root/'internal/notices/THIRD_PARTY_LICENSES.txt';out.write_text(''.join(sections));print(json.dumps({'file':str(out),'bytes':out.stat().st_size,'modules':len(modules),'missing':missing}))
