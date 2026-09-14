#!/usr/bin/env python3
"""Offline, destructive-only-inside-temp acceptance for godie's bundled distribution.

The candidate is copied outside the repository. Every candidate invocation gets
PATH=/nonexistent and --offline. Process cleanup addresses only process groups
created by this harness (start_new_session=True and verified pgid == pid).
"""
from __future__ import annotations
import argparse, concurrent.futures, fcntl, hashlib, json, os, pathlib, re, shutil, signal, stat, subprocess, tempfile, time

def extraction_lock_released(root):
    """A persistent flock inode is correct; require it to be unlocked, not absent."""
    lock = root / ".extract.lock"
    if not lock.exists():
        return True
    try:
        with lock.open("r+") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        return True
    except OSError:
        return False

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXPECTED_BUN_SHA256 = "69293d3be4f0d6d624ca8581af4574435fa39209ab67e89eb03912866f3e14cb"
EXPECTED_BUN_VERSION = "1.4.1"
EXPECTED_GZIP_SHA256 = "b847b1df184228a6d90b7625089bc5e2a10b0c052bf754788cbc1c1bc4d4c44c"
RUNNER_PREFIX = "81d6f82ff99c8812"

def sha(path: pathlib.Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def kill_owned(p: subprocess.Popen) -> None:
    if p.poll() is not None: return
    try:
        if os.getpgid(p.pid) != p.pid: raise RuntimeError("refusing cleanup: child does not own its process group")
        os.killpg(p.pid, signal.SIGTERM)
        try: p.wait(2)
        except subprocess.TimeoutExpired: os.killpg(p.pid, signal.SIGKILL); p.wait(2)
    except ProcessLookupError: pass

def invoke(binary: pathlib.Path, state: pathlib.Path, code: str, cwd: pathlib.Path, timeout=20):
    env={"PATH":"/nonexistent","HOME":str(state.parent/"home"),"LANG":"C.UTF-8","LC_ALL":"C.UTF-8",
         "HTTP_PROXY":"http://127.0.0.1:9","HTTPS_PROXY":"http://127.0.0.1:9","ALL_PROXY":"http://127.0.0.1:9",
         "NO_PROXY":"*","GODIE_STATE_DIR":str(state)}
    cmd=[str(binary),"--offline","--no-session","--state-dir",str(state),"--cwd",str(cwd),"--execute",code]
    started=time.monotonic(); p=subprocess.Popen(cmd,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
    try:
        out,err=p.communicate(timeout=timeout); timed=False
    except subprocess.TimeoutExpired:
        timed=True; kill_owned(p); out,err=p.communicate()
    return {"command":cmd,"returncode":p.returncode,"stdout":out[-4000:],"stderr":err[-4000:],"seconds":round(time.monotonic()-started,3),"timed_out":timed}

def runtime_root(state: pathlib.Path) -> pathlib.Path:
    roots=list((state/"runtimes"/f"bun-{EXPECTED_BUN_VERSION}").glob("*"))
    if len(roots)!=1: raise RuntimeError(f"expected one runtime root, got {roots}")
    return roots[0]

def result(name,status,detail="",kind="acceptance"):
    return {"name":name,"status":status,"kind":kind,"detail":detail}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--binary",type=pathlib.Path,default=ROOT/"artifacts/distribution-godie-source-build"); ap.add_argument("--concurrency",type=int,default=50); ap.add_argument("--json",type=pathlib.Path,default=ROOT/"artifacts/distribution-results.json"); a=ap.parse_args()
    if a.concurrency < 50: ap.error("--concurrency must be at least 50")
    binary=a.binary.resolve(); results=[]; facts={"candidate":str(binary),"candidate_sha256":sha(binary),"candidate_bytes":binary.stat().st_size,"concurrency":a.concurrency,"path":"/nonexistent","network_mode":"--offline plus loopback-refusing proxy variables; no internet operation is requested"}
    with tempfile.TemporaryDirectory(prefix="godie-distribution-") as td:
      own=pathlib.Path(td); copied=own/"isolated copy/bin/godie"; copied.parent.mkdir(parents=True); shutil.copy2(binary,copied); copied.chmod(0o700)
      cwd=own/"work space-\u03BB"; cwd.mkdir(); (cwd/"dep.ts").write_text("export const answer: number = 42;\n")
      # Real TS, dynamic import, Node fs, Bun.write/read, and image path handling.
      code="""import {readFile} from 'node:fs/promises'; const m=await import('./dep.ts'); await Bun.write('tiny.png', Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwM8AAAAAElFTkSuQmCC'),c=>c.charCodeAt(0))); const b=await readFile('tiny.png'); await showImage('tiny.png'); console.log(JSON.stringify({answer:m.answer,bun:Bun.version,png:b.length}));"""
      smoke=invoke(copied,own/"smoke-state",code,cwd,30); facts["smoke"]=smoke
      try: smoke_payload=json.loads(smoke["stdout"]); smoke_output=smoke_payload.get("output","")
      except Exception: smoke_payload={}; smoke_output=""
      ok=smoke["returncode"]==0 and '"answer":42' in smoke_output and f'"bun":"{EXPECTED_BUN_VERSION}"' in smoke_output and bool(smoke_payload.get("images"))
      results.append(result("isolated offline TS/fs/image smoke","PASS" if ok else "FAIL",f"rc={smoke['returncode']} time={smoke['seconds']}s"))
      rr=runtime_root(own/"smoke-state"); bun=rr/"bun"; facts["runtime_root_component"]=rr.name; facts["extracted_bun_sha256"]=sha(bun); facts["extracted_bun_mode"]=oct(stat.S_IMODE(bun.stat().st_mode)); facts["bun_version_from_execute"]=EXPECTED_BUN_VERSION if f'"bun":"{EXPECTED_BUN_VERSION}"' in smoke_output else "not observed"
      results.append(result("runtime version/hash/mode","PASS" if sha(bun)==EXPECTED_BUN_SHA256 and stat.S_IMODE(bun.stat().st_mode)==0o700 else "FAIL",f"version output={facts['bun_version_from_execute']}; sha256={sha(bun)}; mode={facts['extracted_bun_mode']}"))

      # Fifty processes all begin against one absent cache.
      cstate=own/"concurrent-state"; gate=time.monotonic()+0.5
      def one(i):
        while time.monotonic()<gate: time.sleep(.002)
        return invoke(copied,cstate,f"console.log('startup-{i}-'+Bun.version)",cwd,30)
      with concurrent.futures.ThreadPoolExecutor(max_workers=a.concurrency) as ex: runs=list(ex.map(one,range(a.concurrency)))
      bad=[i for i,r in enumerate(runs) if r["returncode"]!=0 or f"startup-{i}-{EXPECTED_BUN_VERSION}" not in r["stdout"]]
      bad_details=[{"index":i,"returncode":runs[i]["returncode"],"stdout":runs[i]["stdout"],"stderr":runs[i]["stderr"]} for i in bad]
      cr=runtime_root(cstate); leftovers=[p.name for p in cr.iterdir() if p.name.startswith(".bun-")]
      good=not bad and sha(cr/"bun")==EXPECTED_BUN_SHA256 and not leftovers and extraction_lock_released(cr)
      facts["concurrent"]={"failures":bad,"failure_details":bad_details,"leftovers":leftovers,"max_seconds":max(r['seconds'] for r in runs),"sum_output_bytes":sum(len(r['stdout'])+len(r['stderr']) for r in runs)}
      results.append(result(f"{a.concurrency} concurrent first startups","PASS" if good else "FAIL",f"failed indexes={bad}; leftovers={leftovers}; max={facts['concurrent']['max_seconds']}s"))

      # Corrupt bytes and executable mode are repaired before execution.
      bun.write_bytes(b"corrupt cache bytes"); bun.chmod(0o600); rep=invoke(copied,own/"smoke-state","console.log('repair-'+Bun.version)",cwd,30)
      good=rep["returncode"]==0 and sha(bun)==EXPECTED_BUN_SHA256 and stat.S_IMODE(bun.stat().st_mode)==0o700
      results.append(result("corrupted/non-executable Bun cache repair","PASS" if good else "FAIL",f"rc={rep['returncode']}; repaired_sha256={sha(bun)}; mode={oct(stat.S_IMODE(bun.stat().st_mode))}"))

      # Kill a real first-start process group while its extraction lock exists.
      istate=own/"interrupted-state"
      ienv={"PATH":"/nonexistent","HOME":str(own/"interrupted-home"),"LANG":"C.UTF-8","LC_ALL":"C.UTF-8","GODIE_STATE_DIR":str(istate)}
      icmd=[str(copied),"--offline","--no-session","--state-dir",str(istate),"--cwd",str(cwd),"--execute","console.log('unexpected-complete')"]
      ip=subprocess.Popen(icmd,cwd=cwd,env=ienv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
      observed=None; deadline=time.monotonic()+5
      while time.monotonic()<deadline and ip.poll() is None:
        locks=list(istate.glob("runtimes/bun-*/*/.extract.lock"))
        if locks: observed=locks[0]; break
        time.sleep(.0005)
      if observed is not None:
        if os.getpgid(ip.pid) != ip.pid: raise RuntimeError("refusing hard interruption outside owned process group")
        os.killpg(ip.pid,signal.SIGKILL); ip.wait(2); ip.communicate(); interrupted=invoke(copied,istate,"console.log('interrupted-recovered')",cwd,8)
        iok=interrupted["returncode"]==0 and "interrupted-recovered" in interrupted["stdout"]
        results.append(result("real interrupted extraction recovery","PASS" if iok else "FAIL",f"lock observed and creator killed; retry rc={interrupted['returncode']}; stderr={interrupted['stderr'].strip()!r}"))
      else:
        kill_owned(ip); ip.communicate(); results.append(result("real interrupted extraction recovery","SKIP","extraction lock was too brief to observe safely"))

      # Deterministic interrupted-extractor residue. A dead creator leaves O_EXCL lock behind.
      bun.unlink(); (rr/".bun-interrupted-owned").write_bytes(b"partial"); (rr/".extract.lock").write_text("dead owned test process\n")
      stale=invoke(copied,own/"smoke-state","console.log('stale-recovered')",cwd,8)
      recovered=stale["returncode"]==0 and bun.exists() and sha(bun)==EXPECTED_BUN_SHA256 and extraction_lock_released(rr)
      results.append(result("interrupted/stale extraction-lock recovery","PASS" if recovered else "FAIL",f"rc={stale['returncode']}; time={stale['seconds']}s; stderr={stale['stderr'].strip()!r}"))
      (rr/".extract.lock").unlink(missing_ok=True); (rr/".bun-interrupted-owned").unlink(missing_ok=True)
      if not bun.exists(): invoke(copied,own/"smoke-state","console.log('restore')",cwd,30)

      # Existing exact bytes must still have safe type/mode; all targets stay in this temp tree.
      runner=rr/"runner.js"; original=runner.read_bytes(); sentinel=own/"owned-runner-sentinel.js"; sentinel.write_bytes(original); runner.unlink(); runner.symlink_to(sentinel)
      sym=invoke(copied,own/"smoke-state","console.log('symlink-check')",cwd,20); retained=runner.is_symlink()
      results.append(result("cache runner symlink rejection/repair","PASS" if (not retained or (sym["returncode"] != 0 and "symlink-check" not in sym["stdout"])) else "FAIL",f"rc={sym['returncode']}; symlink retained={retained}"))
      runner.unlink(missing_ok=True); runner.write_bytes(original); runner.chmod(0o644)
      mode_run=invoke(copied,own/"smoke-state","console.log('mode-check')",cwd,20); mode=stat.S_IMODE(runner.stat().st_mode)
      results.append(result("cache asset restrictive-mode repair","PASS" if mode==0o600 else "FAIL",f"rc={mode_run['returncode']}; runner mode after startup={oct(mode)}"))

      # Parent path traversal via symlink is tested only into another harness-owned directory.
      pstate=own/"pivot-state"; pivot=own/"owned-pivot-target"; pivot.mkdir(); pstate.mkdir(); (pstate/"runtimes").symlink_to(pivot,target_is_directory=True)
      piv=invoke(copied,pstate,"console.log('pivot-check')",cwd,30); wrote=any(pivot.rglob("bun"))
      results.append(result("cache parent symlink rejection","FAIL" if wrote else "PASS",f"rc={piv['returncode']}; wrote through owned symlink={wrote}"))

      # Read-only damaged cache should fail closed, never run corrupt bytes.
      rostate=own/"readonly-state"; first=invoke(copied,rostate,"console.log('prime')",cwd,30); ror=runtime_root(rostate); robun=ror/"bun"; robun.write_bytes(b"bad"); robun.chmod(0o500); ror.chmod(0o500)
      ro=invoke(copied,rostate,"console.log('MUST-NOT-RUN')",cwd,10); ror.chmod(0o700)
      good=ro["returncode"]!=0 and "MUST-NOT-RUN" not in ro["stdout"]
      results.append(result("read-only corrupt cache fails closed","PASS" if good else "FAIL",f"rc={ro['returncode']}; stderr={ro['stderr'].strip()!r}"))

      # Notices are discoverable without runtime extraction or PATH.
      env={"PATH":"/nonexistent","HOME":str(own/"license-home"),"LANG":"C.UTF-8"}; lic=subprocess.run([str(copied),"--licenses"],env=env,text=True,capture_output=True,timeout=10)
      lgood=lic.returncode==0 and "Bun 1.4.1" in lic.stdout and "Photon 0.3.4" in lic.stdout and "LGPL" in lic.stdout
      facts["licenses"]={"returncode":lic.returncode,"bytes":len(lic.stdout),"modules_without_notice": bool(lic.stdout.split("Modules without a root notice found (requires review):",1)[-1].strip()) if "Modules without a root notice found (requires review):" in lic.stdout else None}
      results.append(result("offline discoverable bundled notices","PASS" if lgood else "FAIL",f"rc={lic.returncode}; bytes={len(lic.stdout)}; Bun/Photon/LGPL markers={lgood}"))

    facts["results"]=results; facts["counts"]={s:sum(r['status']==s for r in results) for s in ("PASS","FAIL","SKIP")}; a.json.parent.mkdir(parents=True,exist_ok=True); a.json.write_text(json.dumps(facts,indent=2)+"\n")
    print(json.dumps(facts,indent=2)); return 1 if any(r['status']=="FAIL" for r in results) else 0
if __name__=="__main__": raise SystemExit(main())
