#!/usr/bin/env bun
// Source-mode entry for the real die isolated executor.
import { runTypeScriptFromStdin } from "../../src/typescript/runner";
await runTypeScriptFromStdin();
