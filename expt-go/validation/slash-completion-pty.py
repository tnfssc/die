#!/usr/bin/env python3
"""Real tmux PTY slash-completion probe. Isolated state, no provider requests."""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, tempfile, time, uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--baseline',type=pathlib.Path,default=ROOT/'bin/die-original');ap.add_argument('--candidate',type=pathlib.Path,default=ROOT/'bin/godie');ap.add_argument('--output',type=pathlib.Path,required=True);ap.add_argument('--assert-behavior',action='store_true');a=ap.parse_args()
 out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
 tmux=shutil.which('tmux'); assert tmux,'tmux required'
 results=[]
 with tempfile.TemporaryDirectory(prefix='slash-pty-') as tmp:
  tmp=pathlib.Path(tmp)
  for label,binary in [('baseline',a.baseline.resolve()),('candidate',a.candidate.resolve())]:
   home=tmp/label/'home'; work=tmp/label/'work';home.mkdir(parents=True);work.mkdir()
   for state in [home/'.die/agent',home/'.godie']:
    (state/'skills/zfixture').mkdir(parents=True);(state/'prompts').mkdir()
    (state/'skills/zfixture/SKILL.md').write_text("---\nname: zfixture\ndescription: Slash completion fixture skill\n---\nOnly fixture content.\n")
    (state/'prompts/ztemplate.md').write_text("---\ndescription: Slash completion fixture template\n---\nFixture template $1\n")
   env={'HOME':str(home),'TMPDIR':str(tmp),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TERM':'xterm-256color','HERDR_ENV':'0','DIE_CODING_AGENT_DIR':str(home/'.die/agent'),'GODIE_STATE_DIR':str(home/'.godie')}
   sock='slash-'+uuid.uuid4().hex; dest=out/label;dest.mkdir(exist_ok=True);frames={}
   def tx(*args,check=True):return subprocess.run([tmux,'-L',sock,*args],capture_output=True,check=check,timeout=8)
   def capture(name):
    time.sleep(.18);raw=tx('capture-pane','-p','-e','-t','pty').stdout;plain=tx('capture-pane','-p','-t','pty').stdout.decode(errors='replace');(dest/(name+'.ansi')).write_bytes(raw);(dest/(name+'.txt')).write_text(plain);frames[name]=plain;return plain
   def literal(text):tx('send-keys','-t','pty','-l',text)
   def keys(*v):tx('send-keys','-t','pty',*v)
   def clear():keys('Escape');keys(*(['BSpace']*128));time.sleep(.15)
   try:
    tx('new-session','-d','-s','pty','-x','100','-y','30','-c',str(work),'env','-i',*[k+'='+v for k,v in env.items()],str(binary),'--offline','--no-session','--no-approve')
    tx('set-option','-t','pty','remain-on-exit','on')
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
     s=tx('capture-pane','-p','-t','pty').stdout.decode(errors='replace')
     if '' in s or 'Ask anything' in s:break
     time.sleep(.1)
    capture('startup');literal('/');capture('slash-menu')
    literal('comp');capture('compact-prefix');keys('Tab');capture('compact-tab');keys('Escape');capture('escape')
    clear();literal('/comp');keys('Escape');capture('escape-open')
    clear();literal('/mo');capture('mode-prefix');keys('Down');capture('mode-down');keys('Tab');capture('mode-tab')
    clear();literal('/mo');keys('Down');capture('mode-before-enter');keys('Enter');capture('mode-enter')
    clear();literal('/skill:zfi');capture('skill-prefix');keys('Tab');capture('skill-tab')
    clear();literal('/ztem');capture('template-prefix');keys('Tab');capture('template-tab')
    clear();literal('/ne');capture('new-prefix');keys('Tab');capture('new-tab')
    clear();literal('/comp');capture('before-cancel');keys('C-c');capture('cancel-clears-menu')
    clear();literal('ordinary /comp');capture('ordinary-text')
    clear();keys('C-c');time.sleep(.12);keys('C-c');time.sleep(.7)
    status=tx('display-message','-p','-t','pty','#{pane_dead_status}').stdout.decode().strip()
    def draft(name):
     lines=[s.strip()[1:].strip() for s in frames[name].splitlines() if s.strip().startswith(('','◐'))]
     return lines[-1] if lines else None
    def menu(name):return bool(re.search(r'^\s*[›→]\s+',frames[name],re.M))
    checks={
     'slash_opens_menu':menu('slash-menu'),
     'prefix_filters':menu('compact-prefix') and 'compact' in frames['compact-prefix'],
     'tab_completes':draft('compact-tab')=='/compact',
     'no_stale_menu_rows':not menu('compact-tab') and sum(s.strip().startswith('') for s in frames['compact-tab'].splitlines())==1,
     'arrows_select':bool(re.search(r'[›→]\s*/?mode\b',frames['mode-down'])),
     'enter_submits_selection':draft('mode-enter')=='',
     'escape_preserves_draft':draft('escape-open')=='/comp' and not menu('escape-open'),
     'skill_completes':draft('skill-tab')=='/skill:zfixture',
     'template_completes':draft('template-tab')=='/ztemplate',
     'new_completes':draft('new-tab')=='/new',
     'cancel_clears_menu':draft('cancel-clears-menu')=='' and not menu('cancel-clears-menu'),
     'ordinary_text_untouched':draft('ordinary-text')=='ordinary /comp' and not menu('ordinary-text'),
     'clean_exit':status=='0',
    }
    result={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'side':label,'binary':str(binary),'sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'compact_suggestion':'compact' in frames['compact-prefix'],'skill_suggestion':'skill:zfixture' in frames['skill-prefix'],'template_suggestion':'ztemplate' in frames['template-prefix'],'exit_status':status,'provider_calls':0,'frames':list(frames)}
    results.append(result)
   finally:tx('kill-server',check=False)
 manifest={'results':results,'provider_calls':0,'evidence_only':not a.assert_behavior,'normalization':'none; inspect raw screen frames; fixture dirs differ'};(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))
 if a.assert_behavior and any(r['status']!='PASS' for r in results):raise SystemExit(1)
if __name__=='__main__':main()
