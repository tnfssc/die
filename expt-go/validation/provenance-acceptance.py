#!/usr/bin/env python3
"""Independent native-provider provenance acceptance against a pinned godie CLI."""
from __future__ import annotations
import argparse, hashlib, json, os, pathlib, shutil, signal, subprocess, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
PINNED = ROOT / "validation/artifacts/godie-main-integration"
PINNED_SHA256 = "c63c7eb90cc820397ca6b3ae59860fcbed42f13774182865a64c94038ad9f036"
DEFAULT_OUT = ROOT / "validation/artifacts/provenance-acceptance"
DUMMY_KEY = "loopback-not-a-secret"
OA_MODEL = "gpt-provenance-fixture"
AN_MODEL = "claude-provenance-fixture"
MARKERS = {
    "oa_user": "PROV_OA_USER_1", "oa_visible": "PROV_OA_VISIBLE_1",
    "oa_private": "PROV_OA_PRIVATE_REASONING_1",
    "an_user": "PROV_AN_USER_2", "an_visible": "PROV_AN_VISIBLE_2",
    "an_private": "PROV_AN_PRIVATE_THINKING_2",
    "reverse_user": "PROV_OA_USER_3", "reverse_visible": "PROV_OA_VISIBLE_3",
    "checkpoint_user": "PROV_CHECKPOINT_CREATE", "checkpoint_visible": "PROV_CHECKPOINT_VISIBLE",
    "checkpoint_private": "PROV_OPAQUE_CHECKPOINT_PRIVATE", "checkpoint_switch": "PROV_CHECKPOINT_SWITCH",
}

def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")

def marker_hits(value):
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=True)
    return {name: marker in encoded for name, marker in MARKERS.items()}

def portable_texts(body):
    found = []
    def walk(v):
        if isinstance(v, dict):
            for k, x in v.items():
                if k in ("text", "thinking", "encrypted_content", "signature") and isinstance(x, str):
                    for name, marker in MARKERS.items():
                        if marker in x: found.append(name)
                else: walk(x)
        elif isinstance(v, list):
            for x in v: walk(x)
    walk(body.get("input", body.get("messages", [])))
    return sorted(set(found))

def sse(handler, events):
    handler.send_response(200); handler.send_header("Content-Type", "text/event-stream"); handler.send_header("Cache-Control", "no-cache"); handler.end_headers()
    for event in events:
        handler.wfile.write(("data: " + json.dumps(event, separators=(",", ":")) + "\n\n").encode())
    handler.wfile.flush()

def openai_events(visible, private, checkpoint=False):
    items=[]
    if checkpoint:
        items.append({"type":"compaction","id":"cmp_provenance_fixture","encrypted_content":private})
    else:
        items.append({"type":"reasoning","id":"rs_provenance_fixture","encrypted_content":private,"summary":[]})
    items.append({"type":"message","id":"msg_provenance_fixture","role":"assistant","status":"completed","content":[{"type":"output_text","text":visible,"annotations":[]}]})
    events=[]
    for i,item in enumerate(items):
        events += [{"type":"response.output_item.added","output_index":i,"item":item}, {"type":"response.output_item.done","output_index":i,"item":item}]
    events.append({"type":"response.completed","response":{"id":"resp_provenance_fixture","status":"completed","output":items,"usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18,"input_tokens_details":{"cached_tokens":0,"cache_write_tokens":0},"output_tokens_details":{"reasoning_tokens":2}}}})
    return events

def anthropic_events():
    return [
      {"type":"message_start","message":{"id":"msg_an_provenance","type":"message","role":"assistant","model":AN_MODEL,"content":[],"stop_reason":None,"usage":{"input_tokens":13,"output_tokens":0}}},
      {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}},
      {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":MARKERS["an_private"]}},
      {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"fixture-signature"}},
      {"type":"content_block_stop","index":0},
      {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}},
      {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":MARKERS["an_visible"]}},
      {"type":"content_block_stop","index":1},
      {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":None},"usage":{"output_tokens":8}},
      {"type":"message_stop"},
    ]

class Fixture(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self):
        super().__init__(("127.0.0.1",0), Handler); self.records=[]; self.lock=threading.Lock()

class Handler(BaseHTTPRequestHandler):
    server: Fixture
    def log_message(self, *_): pass
    def do_POST(self):
        try:
            n=int(self.headers.get("content-length","0")); raw=self.rfile.read(n); body=json.loads(raw)
            rec={"ordinal":len(self.server.records)+1,"path":self.path,"provider":"anthropic" if self.path.endswith("/v1/messages") else "openai","marker_hits":marker_hits(body),"payload_marker_names":portable_texts(body),"model":body.get("model"),"thinking":body.get("thinking"),"reasoning":body.get("reasoning"),"stream":body.get("stream"),"raw_body_recorded":False}
            with self.server.lock: self.server.records.append(rec)
            encoded=json.dumps(body)
            if self.path.endswith("/responses"):
                if MARKERS["checkpoint_user"] in encoded: ev=openai_events(MARKERS["checkpoint_visible"],MARKERS["checkpoint_private"],True)
                elif MARKERS["reverse_user"] in encoded: ev=openai_events(MARKERS["reverse_visible"],"PROV_OA_PRIVATE_REASONING_3",False)
                else: ev=openai_events(MARKERS["oa_visible"],MARKERS["oa_private"],False)
                sse(self,ev)
            elif self.path.endswith("/v1/messages"): sse(self,anthropic_events())
            else: self.send_error(404)
        except Exception as e:
            self.send_error(500, str(e))

def env_for(home,tmp):
    return {"HOME":str(home),"TMPDIR":str(tmp),"PATH":os.environ.get("PATH","/usr/bin:/bin"),"TERM":"dumb","NO_COLOR":"1","OPENAI_API_KEY":DUMMY_KEY,"ANTHROPIC_API_KEY":DUMMY_KEY}

def run(argv,cwd,env,out,name,timeout=12):
    started=time.monotonic(); p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,text=True)
    timed=False; cleanup="natural_exit"
    try: stdout,stderr=p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed=True; cleanup=f"SIGTERM_exact_process_group_{p.pid}"; os.killpg(p.pid,signal.SIGTERM)
        try: stdout,stderr=p.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            cleanup=f"SIGKILL_exact_process_group_{p.pid}"; os.killpg(p.pid,signal.SIGKILL); stdout,stderr=p.communicate()
    safe_argv=[str(x) for x in argv]
    for i,x in enumerate(safe_argv[:-1]):
        if x=="--api-key": safe_argv[i+1]="[REDACTED]"
    result={"argv":safe_argv,"exit_code":p.returncode,"timed_out":timed,"elapsed_seconds":round(time.monotonic()-started,3),"owned_process_group":p.pid,"cleanup":cleanup,"stdout":stdout,"stderr":stderr}
    dump(out/(name+".json"),result); return result

def session_files(folder): return sorted(folder.rglob("*.jsonl"),key=lambda p:p.stat().st_mtime_ns)
def session_evidence(path):
    raw=path.read_text(); lines=[]
    for line in raw.splitlines():
        try: lines.append(json.loads(line))
        except json.JSONDecodeError: lines.append({"invalid":True})
    return {"path":str(path),"line_count":len(lines),"marker_hits":marker_hits(lines),"private_markers_persisted":{k:marker_hits(lines)[k] for k in ("oa_private","an_private","checkpoint_private")},"record_types":[x.get("type") for x in lines]}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--candidate",type=pathlib.Path,default=PINNED); ap.add_argument("--output",type=pathlib.Path,default=DEFAULT_OUT); ap.add_argument("--expected-sha256",default=PINNED_SHA256,help="Expected hash of this explicitly selected candidate snapshot"); a=ap.parse_args()
    binary=a.candidate.resolve(); out=a.output.resolve(); shutil.rmtree(out,ignore_errors=True); out.mkdir(parents=True)
    actual=hashlib.sha256(binary.read_bytes()).hexdigest() if binary.is_file() else None
    temp=pathlib.Path(tempfile.mkdtemp(prefix="provenance-acceptance-")); fixture=Fixture(); thread=threading.Thread(target=fixture.serve_forever,name="provenance-loopback",daemon=True); thread.start()
    base=f"http://127.0.0.1:{fixture.server_address[1]}"; evidence={}; checks={}
    try:
        home,tmp,cwd,sessions=(temp/x for x in ("home","tmp","workspace","sessions"))
        for p in (home,tmp,cwd,sessions): p.mkdir(parents=True)
        env=env_for(home,tmp)
        common=[str(binary),"--state-dir",str(home/".godie"),"--session-dir",str(sessions),"--api-key",DUMMY_KEY,"--base-url",base,"--thinking","medium","-p"]
        p1=run(common+["--provider","openai","--model",OA_MODEL,"--session-id","provenance-standard",MARKERS["oa_user"]],cwd,env,out,"standard-1-openai")
        fs=session_files(sessions); standard=fs[-1] if fs else None
        p2=run(common+["--provider","anthropic","--model",AN_MODEL,"--session",str(standard),MARKERS["an_user"]],cwd,env,out,"standard-2-anthropic") if standard else None
        p3=run(common+["--provider","openai","--model",OA_MODEL,"--session",str(standard),MARKERS["reverse_user"]],cwd,env,out,"standard-3-openai-reverse") if standard else None
        standard_records=list(fixture.records)
        evidence["standard_session"]=session_evidence(standard) if standard else None
        # Separate actual CLI-persisted opaque item. Real Codex /compact requires OAuth,
        # so the loopback Responses transport returns a schema-valid compaction item.
        cpdir=temp/"checkpoint-sessions"; cpdir.mkdir()
        cp_common=[str(binary),"--state-dir",str(home/".godie"),"--session-dir",str(cpdir),"--api-key",DUMMY_KEY,"--base-url",base,"--thinking","medium","-p"]
        cp1=run(cp_common+["--provider","openai","--model",OA_MODEL,"--session-id","provenance-checkpoint",MARKERS["checkpoint_user"]],cwd,env,out,"checkpoint-1-create")
        cpf=session_files(cpdir); cppath=cpf[-1] if cpf else None; before=len(fixture.records)
        cp2=run(cp_common+["--provider","anthropic","--model",AN_MODEL,"--session",str(cppath),MARKERS["checkpoint_switch"]],cwd,env,out,"checkpoint-2-incompatible") if cppath else None
        after=len(fixture.records); evidence["checkpoint_session"]=session_evidence(cppath) if cppath else None
        recs=list(fixture.records); dump(out/"requests-redacted.json",recs)
        oa1=standard_records[0] if len(standard_records)>0 else {}; an2=standard_records[1] if len(standard_records)>1 else {}; oa3=standard_records[2] if len(standard_records)>2 else {}
        checks={
          "pinned_sha256":actual==a.expected_sha256,
          "three_standard_cli_calls_succeeded":all(x and x["exit_code"]==0 and not x["timed_out"] for x in (p1,p2,p3)),
          "openai_visible_and_private_persisted":bool(standard and MARKERS["oa_visible"] in standard.read_text() and MARKERS["oa_private"] in standard.read_text()),
          "anthropic_received_openai_visible":bool(an2.get("marker_hits",{}).get("oa_visible")),
          "anthropic_did_not_receive_openai_private":not bool(an2.get("marker_hits",{}).get("oa_private")),
          "anthropic_explicit_reasoning_medium":an2.get("thinking",{}).get("type")=="enabled" and an2.get("thinking",{}).get("budget_tokens")==8192,
          "reverse_openai_received_both_visible":bool(oa3.get("marker_hits",{}).get("oa_visible") and oa3.get("marker_hits",{}).get("an_visible")),
          "reverse_openai_did_not_receive_anthropic_private":not bool(oa3.get("marker_hits",{}).get("an_private")),
          "openai_explicit_reasoning_medium":(oa1.get("reasoning") or {}).get("effort")=="medium" and (oa3.get("reasoning") or {}).get("effort")=="medium",
          "checkpoint_created_by_cli_and_persisted":bool(cppath and MARKERS["checkpoint_private"] in cppath.read_text()),
          "incompatible_checkpoint_refused_before_transport":bool(cp2 and cp2["exit_code"]!=0 and after==before and "opaque checkpoint provider/model mismatch" in (cp2["stderr"]+cp2["stdout"])),
          "bounded_request_count":after==4,
        }
        status="PASS" if all(checks.values()) else "FAIL"
        result={"status":status,"candidate":str(binary),"candidate_sha256":actual,"expected_sha256":a.expected_sha256,"fixture_base":"loopback-redacted","request_count":after,"request_limit":4,"checks":checks,"notes":{"standard_visible_history":"Portable assistant text is normalized and crosses provider boundaries; provider-private Native does not.","opaque_checkpoint":"A model-bound compaction Native item is not portable and must hard-fail before transport.","compaction_fixture":"CLI-persisted schema-valid Responses compaction item; native Codex /compact was infeasible offline because it requires OAuth JWT/account credentials."},"cleanup":{"http_server":"shutdown+server_close+thread_join","subprocesses":"each isolated with start_new_session; timeout targets only its exact process group","temporary_tree":str(temp)}}
        dump(out/"result.json",result)
        print(json.dumps(result,indent=2)); raise SystemExit(0 if status=="PASS" else 1)
    finally:
        fixture.shutdown(); fixture.server_close(); thread.join(timeout=2); shutil.rmtree(temp,ignore_errors=True)
if __name__=="__main__": main()
