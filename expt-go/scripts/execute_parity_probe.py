#!/usr/bin/env python3
"""Run the independent harness unchanged, relocating only its artifact-root guard."""
import importlib.util,pathlib,sys
sys.dont_write_bytecode=True
root=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('execute_parity',root/'expt-go/validation/execute-parity.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# ROOT is used only for default binary paths and the artifact output allowlist.
# All binary arguments are explicit; no comparison or provider fixture is changed.
m.ROOT=root/'expt-go/evidence'
sys.argv=[str(root/'expt-go/validation/execute-parity.py'),'--original',str(root/'expt-go/bin/die-original'),'--candidate',str(root/'expt-go/bin/godie'),'--output',str(root/'expt-go/evidence/artifacts/execute-parity-final')]
m.main()
