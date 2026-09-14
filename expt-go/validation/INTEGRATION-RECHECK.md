# Independent integration recheck

Main-agent acceptance, 2026-09-13. No whole-app parity claim. Each binary is pinned; evidence from earlier revisions is not silently attributed to later ones.

## Integration snapshot c63c7eb90cc820397ca6b3ae59860fcbed42f13774182865a64c94038ad9f036

- Six execute differential scenarios **MATCH**: TypeScript/modules, Unicode paths/synthetic filename, stdout/stderr spill, exception, timeout and images. Evidence: root artifacts/execute-parity-main-integration.
- Five app-level ownership differential scenarios **PASS**: foreground no duplicate, background once, crash notice recovery, parallel handoff, pending job survives. Evidence: validation/artifacts/integration-main-ownership.
- Session restart/replay, branch history and literal slash print prompts **PASS**. Incomplete Responses SSE fails closed. Evidence: validation/artifacts/integration-main-session.
- Valid OpenAI/Anthropic provenance switching and opaque checkpoint identity refusal **PASS**,4 loopback requests. Evidence: validation/artifacts/provenance-acceptance; details provenance-report.md.
- Six disabled/unknown-option/update CLI diagnostics now match exactly. The custom-provider fixture now executes successfully with matching request count, markers and output; raw diff still records SDK header/payload differences. Help/version and terminal text/style are not exact matches. Terminal layout is now compact inline rather than initial fullscreen chat. Evidence: validation/artifacts/integration-main-cli.

## Distribution snapshot 9c7d9e927e18ea8dd95ebec757083a98b1ea279f3aee05d03abca127b866ed4a

Independently copied bin/godie to validation/artifacts/godie-main-final, then ran distribution-acceptance.py with concurrency50 and a private home-filesystem TMPDIR because system /tmp was full. Result **11 PASS / 0 FAIL**.

Verified relocated offline TS/fs/images, Bun version/hash/mode,50 first starts with correct nonempty markers, corrupt cache repair, real SIGKILL extraction recovery, preexisting lock recovery, runner symlink rejection, restrictive mode repair, parent symlink rejection, read-only corrupt cache refusal, bundled notices. Evidence: validation/artifacts/final-main-distribution.json. Kernel flock lock inode may persist; oracle checks lock is released rather than wrongly requiring unlink. Symlink rejection correctly allows retained link when startup fails before execute.

## Harness corrections

The session harness former native probe emitted the wrong provider protocol and had no successful path. It is retired as NOT_RUN, with actual cross-provider validation in provenance-acceptance.py. Historical raw evidence retained. The distribution lock assertion was updated for kernel flock (persistent inode is correct and avoids inode replacement races), not relaxed to ignore held locks.

## Remaining boundaries

No live calls by main acceptance suites; historical bounded live tests are separately recorded by implementation. No further live budget assumed. Arbitrary Pi extension compatibility, complete CLI/RPC/resource/theme catalog, exact terminal rendering, release Bun provenance and redistribution obligations require separate status from these passing gates. Consult ../PARITY.md for whole-product coverage.
