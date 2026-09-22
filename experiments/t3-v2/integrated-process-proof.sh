#!/usr/bin/env bash
# OS-level negative spawn evidence for the scripted real-engine scenario only.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
command -v strace >/dev/null || { echo "error: strace required" >&2; exit 1; }
TRACE="$(mktemp "$HERE/.runtime/integrated-exec.XXXXXX")"
trap 'rm -f "$TRACE"' EXIT
strace -f -qq -s 4096 -e trace=execve -o "$TRACE" "$HERE/integrated-real-probe.sh"
python3 - "$TRACE" "$HERE/integrated-process-proof.json" "$HERE/.runtime/integrated-real.log" <<'PY'
import json,re,sys
rows=[]
for line in open(sys.argv[1]):
    if 'execve(' not in line or ' = 0' not in line: continue
    args=re.findall(r'"((?:[^"\\]|\\.)*)"',line)
    if not args: continue
    binary=args[0]
    if not binary.endswith('/dist/die'): continue
    argv=args[1:]
    mode=argv[argv.index('--mode')+1] if '--mode' in argv else None
    category='rpc-provider' if mode=='rpc' else 'local-subagent' if mode=='json' else 'execute-worker' if '--die-internal-execute' in argv else 'other-die'
    rows.append({'pid':int(line.split()[0]),'binary':'dist/die','mode':mode,'category':category})
proof={'scope':'scripted real-engine success/retry/cancel only; local helper is NOT disabled','processes':rows,'providerRpcCount':sum(r['category']=='rpc-provider' for r in rows),'localSubagentCount':sum(r['category']=='local-subagent' for r in rows)}
for line in open(sys.argv[3]):
    if line.startswith('INTEGRATED_REAL_EVIDENCE '): proof['engine']=json.loads(line.split(' ',1)[1])
    if line.startswith('INTEGRATED_SCOPE_FINALIZED '): proof['finalization']=json.loads(line.split(' ',1)[1])
assert proof['finalization']['allReaped'] is True, proof
assert set(proof['finalization']['providerPids'])==set(r['pid'] for r in rows if r['category']=='rpc-provider'), proof
assert proof['providerRpcCount']==3, proof
assert proof['localSubagentCount']==0, proof
assert all(r['category']!='other-die' for r in rows), proof
with open(sys.argv[2],'w') as f: json.dump(proof,f,indent=2);f.write('\n')
print(json.dumps(proof,indent=2))
PY
