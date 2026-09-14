#!/usr/bin/env python3
"""Black-box runtime regression recheck for godie --execute.

Every command runs in a fresh state/home/work tree. Cleanup targets only exact
process groups started by this harness or reported through harness-owned pidfiles.
"""
from __future__ import annotations
import argparse, hashlib, json, os, pathlib, re, shlex, signal, subprocess, tempfile, time

CREDENTIAL_KEYS = {"OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"}


def identity(pid: int):
    try:
        fields = pathlib.Path(f"/proc/{pid}/stat").read_text().split()
        return fields[21]
    except (FileNotFoundError, ProcessLookupError, IndexError, PermissionError):
        return None


def alive(pid: int, start=None):
    if start is not None and identity(pid) != start:
        return False
    try:
        state = pathlib.Path(f"/proc/{pid}/stat").read_text().split()[2]
        return state != "Z"
    except (FileNotFoundError, ProcessLookupError, IndexError, PermissionError):
        return False


def kill_owned_group(pid: int, start=None):
    if pid <= 1 or (start is not None and identity(pid) != start):
        return
    try:
        pgid = os.getpgid(pid)
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def wait_dead(pid: int, start, seconds=3.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not alive(pid, start):
            return True
        time.sleep(0.05)
    return not alive(pid, start)


class Harness:
    def __init__(self, binary: pathlib.Path, out: pathlib.Path):
        self.binary = binary.resolve()
        self.out = out.resolve()
        self.out.mkdir(parents=True, exist_ok=True)
        self.root = pathlib.Path(tempfile.mkdtemp(prefix="runtime-recheck-"))
        self.rows = []

    def fresh(self, name):
        root = self.root / name
        home, work, tmp, state = [root / x for x in ("home", "work", "tmp", "state")]
        for p in (home, work, tmp, state): p.mkdir(parents=True, exist_ok=True)
        env = {k:v for k,v in os.environ.items() if k not in CREDENTIAL_KEYS and not k.endswith("_API_KEY")}
        env.update({"HOME":str(home), "TMPDIR":str(tmp), "GODIE_STATE_DIR":str(state), "LANG":"C.UTF-8", "HERDR_ENV":"0", "SHELL":"/bin/sh"})
        return root, work, env

    def invoke(self, name, code, timeout=12.0):
        root, work, env = self.fresh(name)
        started = time.monotonic()
        p = subprocess.Popen([str(self.binary), "--offline", "--execute", code], cwd=work, env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        timed_out = False
        try:
            stdout, stderr = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            kill_owned_group(p.pid)
            stdout, stderr = p.communicate(timeout=3)
        elapsed = time.monotonic() - started
        out_text, err_text = stdout.decode(errors="replace"), stderr.decode(errors="replace")
        (self.out/f"{name}.stdout").write_text(out_text)
        (self.out/f"{name}.stderr").write_text(err_text)
        envelope = None
        try: envelope = json.loads(out_text)
        except Exception: pass
        return {"exitCode":p.returncode, "seconds":round(elapsed,3), "timedOutByHarness":timed_out,
                "stdoutBytes":len(stdout), "stderrBytes":len(stderr), "envelope":envelope}, root

    def marker(self, root, leaf="owned.pid"):
        return root / leaf

    def marker_info(self, marker):
        try:
            pid=int(marker.read_text().strip()); return pid, identity(pid)
        except Exception: return None, None

    def add(self, name, passed, result, details=None):
        row={"scenario":name, "status":"fixed" if passed else "still-fails", **{k:v for k,v in result.items() if k != "envelope"}}
        if result.get("envelope") is not None: row["result"]=result["envelope"]
        if details: row["details"]=details
        self.rows.append(row)

    def run(self):
        # Original P0: a full stdin pipe must not hold the state lock needed by stop.
        root, work, env = self.fresh("stdin-stop")
        marker=self.marker(root); cmd=f"echo $$ > {shlex.quote(str(marker))}; exec sleep 30"
        code=f'''const j=await shell({json.dumps(cmd)},{{waitSeconds:0,closeInput:false}}); const t=Date.now();
const x=await Promise.allSettled([jobs.input(j.id,"x".repeat(900000)),Bun.sleep(100).then(()=>jobs.stop(j.id))]);
console.log(JSON.stringify({{elapsedMs:Date.now()-t,settled:x.map(v=>v.status),job:(await jobs.inspect(j.id)).status}}));'''
        # use precreated state rather than invoke so marker path and invocation share the tree
        started=time.monotonic(); p=subprocess.Popen([str(self.binary),"--offline","--execute",code],cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        timed=False
        try: so,se=p.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            timed=True; kill_owned_group(p.pid); so,se=p.communicate(timeout=3)
        elapsed=time.monotonic()-started; (self.out/"stdin-stop.stdout").write_bytes(so); (self.out/"stdin-stop.stderr").write_bytes(se)
        try: envp=json.loads(so); inner=json.loads(envp.get("output","").strip())
        except Exception: envp=None; inner={}
        pid,ident=self.marker_info(marker); dead=True if not pid else wait_dead(pid,ident,1)
        if pid and not dead: kill_owned_group(pid,ident); dead=wait_dead(pid,ident,1)
        result={"exitCode":p.returncode,"seconds":round(elapsed,3),"timedOutByHarness":timed,"stdoutBytes":len(so),"stderrBytes":len(se),"envelope":envp}
        self.add("stdin-stop", not timed and elapsed<6 and inner.get("job") in ("killed","failed") and dead, result, {"inner":inner,"ownedJobDead":dead})

        code='''const t=Date.now(); const r=await Promise.all([shell("sleep 1; printf A",{waitSeconds:5}),shell("sleep 1; printf B",{waitSeconds:5})]); console.log(JSON.stringify({elapsedMs:Date.now()-t,outputs:r.map(x=>x.output)}));'''
        r,_=self.invoke("parallel-shell",code)
        try: inner=json.loads(r["envelope"]["output"].strip())
        except Exception: inner={}
        self.add("parallel-shell", not r["timedOutByHarness"] and inner.get("elapsedMs",9999)<1900 and inner.get("outputs")==["A","B"],r,{"inner":inner})

        # Handoff must run while another helper is blocked in a foreground wait.
        root,work,env=self.fresh("parallel-handoff"); marker=self.marker(root); cmd=f"echo $$ > {shlex.quote(str(marker))}; exec sleep 30"
        code=f'''const t=Date.now(); await Promise.all([shell({json.dumps(cmd)},{{waitSeconds:30}}),Bun.sleep(100).then(()=>handoff("yield-now"))]);'''
        started=time.monotonic(); p=subprocess.Popen([str(self.binary),"--offline","--execute",code],cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        timed=False
        try: so,se=p.communicate(timeout=7)
        except subprocess.TimeoutExpired: timed=True; kill_owned_group(p.pid); so,se=p.communicate(timeout=3)
        elapsed=time.monotonic()-started; (self.out/"parallel-handoff.stdout").write_bytes(so); (self.out/"parallel-handoff.stderr").write_bytes(se)
        try: envp=json.loads(so)
        except Exception: envp=None
        pid,ident=self.marker_info(marker); dead=True if not pid else wait_dead(pid,ident,1)
        if pid and not dead: kill_owned_group(pid,ident); dead=wait_dead(pid,ident,1)
        rr={"exitCode":p.returncode,"seconds":round(elapsed,3),"timedOutByHarness":timed,"stdoutBytes":len(so),"stderrBytes":len(se),"envelope":envp}
        self.add("parallel-handoff",not timed and elapsed<4 and bool(envp and envp.get("handoff")) and dead,rr,{"ownedJobDeadAfterCliClose":dead})

        # Clean worker exit must kill both detached-stdio and inherited-stdio descendants.
        for suffix, stdio in (("ignored",'stdin:"ignore",stdout:"ignore",stderr:"ignore"'),("inherited",'stdin:"ignore",stdout:"inherit",stderr:"inherit"')):
            root,work,env=self.fresh("descendant-"+suffix); marker=self.marker(root)
            child=f"echo $$ > {shlex.quote(str(marker))}; exec sleep 30"
            code=f'''Bun.spawn(["/bin/sh","-c",{json.dumps(child)}],{{{stdio}}}); while(!(await Bun.file({json.dumps(str(marker))}).exists())) await Bun.sleep(10); console.log("leader-done"); process.exit(0);'''
            started=time.monotonic(); p=subprocess.Popen([str(self.binary),"--offline","--execute",code],cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
            timed=False
            try: so,se=p.communicate(timeout=7)
            except subprocess.TimeoutExpired: timed=True; kill_owned_group(p.pid); so,se=p.communicate(timeout=3)
            elapsed=time.monotonic()-started; (self.out/f"descendant-{suffix}.stdout").write_bytes(so); (self.out/f"descendant-{suffix}.stderr").write_bytes(se)
            try: envp=json.loads(so)
            except Exception: envp=None
            pid,ident=self.marker_info(marker); dead=False if not pid else wait_dead(pid,ident,2)
            if pid and not dead: kill_owned_group(pid,ident); dead=wait_dead(pid,ident,1)
            rr={"exitCode":p.returncode,"seconds":round(elapsed,3),"timedOutByHarness":timed,"stdoutBytes":len(so),"stderrBytes":len(se),"envelope":envp}
            self.add("normal-exit-descendant-"+suffix,not timed and pid is not None and dead and elapsed<5,rr,{"markerPidSeen":pid is not None,"ownedDescendantDead":dead})

        root,work,env=self.fresh("job-timeout"); marker=self.marker(root); cmd=f"echo $$ > {shlex.quote(str(marker))}; exec sleep 30"
        code=f'''const t=Date.now(); const r=await shell({json.dumps(cmd)},{{waitSeconds:3,timeoutSeconds:.3}}); console.log(JSON.stringify({{elapsedMs:Date.now()-t,status:r.status,timedOut:r.timedOut,termination:r.termination}}));'''
        started=time.monotonic(); p=subprocess.Popen([str(self.binary),"--offline","--execute",code],cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        try: so,se=p.communicate(timeout=8); timed=False
        except subprocess.TimeoutExpired: timed=True; kill_owned_group(p.pid); so,se=p.communicate(timeout=3)
        elapsed=time.monotonic()-started; (self.out/"job-timeout.stdout").write_bytes(so); (self.out/"job-timeout.stderr").write_bytes(se)
        try: envp=json.loads(so); inner=json.loads(envp["output"].strip())
        except Exception: envp=None; inner={}
        pid,ident=self.marker_info(marker); dead=True if not pid else wait_dead(pid,ident,1)
        if pid and not dead: kill_owned_group(pid,ident); dead=wait_dead(pid,ident,1)
        rr={"exitCode":p.returncode,"seconds":round(elapsed,3),"timedOutByHarness":timed,"stdoutBytes":len(so),"stderrBytes":len(se),"envelope":envp}
        self.add("job-timeout",not timed and inner.get("timedOut") is True and inner.get("elapsedMs",9999)<2500 and dead,rr,{"inner":inner,"ownedJobDead":dead})

        # SIGTERM of the CLI exercises parent-context cancellation and execute worker group cleanup.
        root,work,env=self.fresh("execute-cancel"); marker=self.marker(root)
        child=f"echo $$ > {shlex.quote(str(marker))}; exec sleep 30"
        code=f'''Bun.spawn(["/bin/sh","-c",{json.dumps(child)}],{{stdin:"ignore",stdout:"ignore",stderr:"ignore"}}); while(!(await Bun.file({json.dumps(str(marker))}).exists())) await Bun.sleep(10); await Bun.sleep(30000);'''
        started=time.monotonic(); p=subprocess.Popen([str(self.binary),"--offline","--execute",code],cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        deadline=time.monotonic()+4
        while not marker.exists() and time.monotonic()<deadline and p.poll() is None: time.sleep(.02)
        p.send_signal(signal.SIGTERM) if p.poll() is None else None
        timed=False
        try: so,se=p.communicate(timeout=7)
        except subprocess.TimeoutExpired: timed=True; kill_owned_group(p.pid); so,se=p.communicate(timeout=3)
        elapsed=time.monotonic()-started; (self.out/"execute-cancel.stdout").write_bytes(so); (self.out/"execute-cancel.stderr").write_bytes(se)
        try: envp=json.loads(so)
        except Exception: envp=None
        pid,ident=self.marker_info(marker); dead=False if not pid else wait_dead(pid,ident,2)
        if pid and not dead: kill_owned_group(pid,ident); dead=wait_dead(pid,ident,1)
        rr={"exitCode":p.returncode,"seconds":round(elapsed,3),"timedOutByHarness":timed,"stdoutBytes":len(so),"stderrBytes":len(se),"envelope":envp}
        self.add("execute-cancel",not timed and pid is not None and dead and elapsed<6 and p.returncode!=0,rr,{"markerPidSeen":pid is not None,"ownedDescendantDead":dead})

        code='process.stdout.write("BEGIN"+"😀".repeat(5000)+"END")'
        r,_=self.invoke("bounded-output",code,12)
        envp=r.get("envelope") or {}; output=envp.get("output",""); m=re.search(r"complete output: (.+?)\]\n",output)
        artifact=pathlib.Path(m.group(1)) if m else None
        artifact_ok=bool(artifact and artifact.exists())
        full=artifact.read_text() if artifact_ok else ""
        mode=(artifact.stat().st_mode & 0o777) if artifact_ok else None
        details={"outputCharacters":len(output),"notice":output.splitlines()[0] if output else "","artifactExists":artifact_ok,"artifactMode":oct(mode) if mode is not None else None,"fullCharacters":len(full)}
        passed=(not r["timedOutByHarness"] and output.endswith("END") and len(output)<=4300 and artifact_ok and full.startswith("BEGIN") and full.endswith("END") and mode==0o600)
        self.add("bounded-output",passed,r,details)

        root,work,env=self.fresh("bounded-output-artifact-failure"); sessions=root/"state"/"sessions"
        code=f'''require("node:fs").chmodSync({json.dumps(str(sessions))},0o500); process.stdout.write("BEGIN"+"z".repeat(5000)+"END")'''
        started=time.monotonic(); p=subprocess.Popen([str(self.binary),"--offline","--execute",code],cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        timed=False
        try: so,se=p.communicate(timeout=10)
        except subprocess.TimeoutExpired: timed=True; kill_owned_group(p.pid); so,se=p.communicate(timeout=3)
        try: sessions.chmod(0o700)
        except Exception: pass
        elapsed=time.monotonic()-started; (self.out/"bounded-output-artifact-failure.stdout").write_bytes(so); (self.out/"bounded-output-artifact-failure.stderr").write_bytes(se)
        try: envp=json.loads(so)
        except Exception: envp=None
        output=(envp or {}).get("output",""); rr={"exitCode":p.returncode,"seconds":round(elapsed,3),"timedOutByHarness":timed,"stdoutBytes":len(so),"stderrBytes":len(se),"envelope":envp}
        self.add("bounded-output-artifact-failure",not timed and "full output could not be saved" in output and output.endswith("END"),rr,{"notice":output.splitlines()[0] if output else "","outputCharacters":len(output)})

        code='''const rs=await Promise.all(Array.from({length:12},()=>shell("exec /usr/bin/python3 -c \'import os; os.write(1,bytes([120])*131072)\'",{waitSeconds:5}))); console.log(JSON.stringify({count:rs.length,statuses:[...new Set(rs.map(x=>x.status))],ends:[...new Set(rs.map(x=>x.outputEnd))]}));'''
        r,_=self.invoke("foreground-capture-complete",code,15)
        try: inner=json.loads(r["envelope"]["output"].strip())
        except Exception: inner={}
        self.add("foreground-capture-complete",not r["timedOutByHarness"] and inner=={"count":12,"statuses":["completed"],"ends":[131072]},r,{"inner":inner})

        code='''const xs=await Promise.all(Array.from({length:50},(_,i)=>shell("printf job_"+i,{waitSeconds:0}))); const end=Date.now()+6000; let all; do {all=await jobs.list({count:100}); if(all.jobs.filter(x=>x.status!=="running").length===50) break; await Bun.sleep(25)} while(Date.now()<end); console.log(JSON.stringify({launched:xs.length,total:all.total,done:all.jobs.filter(x=>x.status!=="running").length,completed:all.jobs.filter(x=>x.status==="completed").length}));'''
        r,_=self.invoke("fifty-tasks",code,15)
        try: inner=json.loads(r["envelope"]["output"].strip())
        except Exception: inner={}
        self.add("fifty-tasks",not r["timedOutByHarness"] and inner=={"launched":50,"total":50,"done":50,"completed":50},r,{"inner":inner})

        report={"generatedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"binary":str(self.binary),
                "binarySHA256":hashlib.sha256(self.binary.read_bytes()).hexdigest(),"binaryMtime":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(self.binary.stat().st_mtime)),
                "isolatedRoot":str(self.root),"credentialsRemoved":True,"results":self.rows}
        (self.out/"manifest.json").write_text(json.dumps(report,indent=2)+"\n")
        print(json.dumps(report,indent=2))
        return 0 if all(x["status"]=="fixed" for x in self.rows) else 1


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("binary",type=pathlib.Path); ap.add_argument("output",type=pathlib.Path); args=ap.parse_args()
    raise SystemExit(Harness(args.binary,args.output).run())
if __name__=="__main__": main()
