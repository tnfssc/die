#!/usr/bin/env python3
"""Offline CLI acceptance for literal models.json native adapters."""
import json, os, pathlib, subprocess, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

seen=[]
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get("content-length","0"))))
        seen.append((self.path,dict(self.headers),body))
        self.send_response(200); self.send_header("content-type","text/event-stream"); self.end_headers()
        if self.path.endswith("/responses"):
            data={"type":"response.completed","response":{"id":"r","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"responses-ok"}]}],"usage":{}}}
            self.wfile.write(("data: "+json.dumps(data)+"\n\n").encode())
        elif self.path.endswith("/messages"):
            for data in ({"type":"message_start","message":{"id":"a","usage":{}}},{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"anthropic-ok"}},{"type":"content_block_stop","index":0},{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{}},{"type":"message_stop"}): self.wfile.write(("data: "+json.dumps(data)+"\n\n").encode())
        else:
            self.wfile.write(("data: "+json.dumps({"candidates":[{"content":{"role":"model","parts":[{"text":"gemini-ok"}]},"finishReason":"STOP"}]})+"\n\n").encode())

def main():
    binary=pathlib.Path(os.environ.get("GODIE_BIN","validation/artifacts/godie-config-native")).resolve()
    server=ThreadingHTTPServer(("127.0.0.1",0),H); threading.Thread(target=server.serve_forever,daemon=True).start(); base=f"http://127.0.0.1:{server.server_port}"
    with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR",str(pathlib.Path.home()))) as state:
        providers={
          "fixture-responses":{"baseUrl":base+"/v1","api":"openai-responses","apiKey":"responses-key","headers":{"X-Fixture":"responses"},"models":[{"id":"r-model","maxTokens":123}]},
          "fixture-anthropic":{"baseUrl":base+"/v1","api":"anthropic-messages","apiKey":"anthropic-key","headers":{"X-Fixture":"anthropic"},"models":[{"id":"a-model","maxTokens":124}]},
          "fixture-gemini":{"baseUrl":base+"/v1beta","api":"google-generative-ai","apiKey":"gemini-key","headers":{"X-Fixture":"gemini"},"models":[{"id":"g-model","maxTokens":125}]}}
        pathlib.Path(state,"models.json").write_text(json.dumps({"providers":providers}))
        for provider,model,want in (("fixture-responses","r-model","responses-ok"),("fixture-anthropic","a-model","anthropic-ok"),("fixture-gemini","g-model","gemini-ok")):
            cp=subprocess.run([str(binary),"--state-dir",state,"--no-session","--print","--provider",provider,"--model",model,"hello"],text=True,capture_output=True,timeout=20)
            assert cp.returncode==0,(provider,cp.stderr); assert want in cp.stdout,(provider,cp.stdout,cp.stderr)
    server.shutdown()
    paths=[x[0] for x in seen]; assert "/v1/responses" in paths and "/v1/messages" in paths and any(p.startswith("/v1beta/models/g-model:streamGenerateContent") for p in paths),paths
    for path,h,b in seen:
        expected="responses" if path.endswith("responses") else "anthropic" if path.endswith("messages") else "gemini"
        assert h.get("X-Fixture")==expected,(path,h)
        if expected=="responses": assert b.get("model")=="r-model" and b.get("max_output_tokens")==123,b
        elif expected=="anthropic": assert b.get("model")=="a-model" and b.get("max_tokens")==124,b
        else: assert b.get("generationConfig",{}).get("maxOutputTokens")==125,b
        forbidden={"responses":{"X-Api-Key","X-Goog-Api-Key"},"anthropic":{"Authorization","X-Goog-Api-Key"},"gemini":{"Authorization","X-Api-Key"}}[expected]
        assert not any(h.get(k) for k in forbidden),(path,h)
    print("PASS configured Responses/Anthropic/Gemini CLI routes, defaults, headers, provenance-safe auth")
if __name__=="__main__": main()
