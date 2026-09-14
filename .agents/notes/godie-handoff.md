> Renamed 2026-09-14: directory `godie` → `expt-go`; explicitly experimental. Executable/module remain `godie`, state remains `~/.godie`. Historical artifact/report paths refer to the pre-rename directory.

# Godie implementation handoff — 2026-09-13 22:33 UTC

## User intent and decisions

User requested same app rebuilt in ./expt-go, research via tvly, then implement and verify real behavior (not just self-authored tests). Initially full Go only; reconsidered execute and explicitly chose embedded/bundled Bun. Final architecture Go CLI/TUI/providers/sessions/agents/jobs; bundled Bun1.4.1 solely executes JS/TS, not a Pi launcher. Existing TypeScript app/state/install left untouched.

## Current result

Runnable Linux amd64 development binary `expt-go/bin/godie`,48,701,732bytes, SHA25658cb0acbf54ba2e774a6b0ee0aea5f9473f002f8d965153e50eaa638644ac963. Separate source rebuild byte-identical. Build `cd expt-go && ./scripts/build.sh`. Default state ~/.godie; explicit Codex credential import/login, never auto import ~/.die. README documents run/setup. Nothing committed or installed.

Core and Markdown skills/templates/native custom provider config implemented. Pure Go resource discovery/expansion; custom Chat Completions/Responses/Anthropic/Gemini APIs plus model/header/capability overrides; configured context window affects compaction/footer. Go sessions, goals/history/memory, execution helpers/jobs/subagents, compact inline TUI and navigation implemented.

## Validation

All work/jobs finished. Main-owned `expt-go/validation/FINAL-COMBINED.md` and `RESOURCES-RECHECK.md` summarize final evidence. Full race/vet PASS; actual runtime11, execute6 differential, ownership5 differential, distribution11 with50firststarts, session4, proper provenance4requests, custom native3API CLI, real terminal streaming and actual source-built Die skills/templates all pass stated gates. Raw manifests in expt-go/evidence/final-* and validation/artifacts (gitignored); reviewed reports in validation are tracked sources. Prior false-positive oracles corrected explicitly; no unit-only parity claim.

Independent review found/fixed stdin lock deadlock, runtime cancellation/context bugs, ACK ownership, synchronous helper serialization, incomplete provider SSE, native provenance, actual Codex empty completed-output reducer, synthetic filename/errors, clean-exit descendants, output capture Wait race, stale extraction lock and cache symlink/mode faults.

## Remaining boundaries — DO NOT claim complete parity

See expt-go/PARITY.md current matrix. Writable Pi-session migration, arbitrary Pi JavaScript extensions/package/theme resources, settings/package resource arrays, full CLI/RPC/event catalog and exact terminal styling remain incomplete. Some config interpolation/compatibility knobs and CLI image input envelope differ. Release runtime provenance/LGPL/source/relinking review unresolved: local dev artifact, not approved redistribution.

Live Codex historical tool/background/child runs passed their scoped earlier hashes; greeting initially falsely passed then corrected after actual persistence checks. Final integration made no new live calls. Live budget ledger evidence/LIVE-BUDGET.md says at least23 of24 attempts and remaining budget not safely known: do NOT casually start more paid/live tests. Premium/original native compaction/live-terminal paths unverified.

## Environment

System /tmp tmpfs filled during work; do NOT delete unrelated temp files. Use short owned TMPDIR on home filesystem. scripts/final-checks.sh manages one. Unix mock sockets use short temp prefixes to avoid108byte sockaddr limit. gofmt is not on PATH; absolute /home/tnfssc/.local/share/mise/installs/go/1.25.7/bin/gofmt. Go1.25.7. Older decisions/history in godie-research.md.

## Experimental rename validation — 2026-09-14

User explicitly requested experimental status and directory name expt-go. Renamed ./godie to ./expt-go, updated active docs, script/default harness paths and CLI --help experimental label. Module/executable godie and ~/.godie intentionally unchanged. Rebuilt binary successfully using owned home-filesystem TMPDIR (/tmp still full); focused app options/CLI/resources tests pass. Earlier evidence hashes describe pre-label binaries and are not silently reassigned to this rebuild. No installs or original app edits.

## Active slash autocomplete fix — 2026-09-14 06:26 UTC

User reported slash menu has no autocomplete. Worker task_d194099c owns TUI/narrow cmd implementation, must match original prefix/list/Tab/navigation and resource suggestions. Main owns independent validation/slash-completion-pty.py. Before-fix binary pinned validation/artifacts/slash-before/godie; baseline-vs-before real tmux probe task_3751997c running (no auth/provider calls), frames under slash-before/screens. Need review baseline semantics, integrate worker, build final bin, rerun real PTY incl Enter/Tab/dynamic skills/templates + regressions, update notes. Directory expt-go, module/executable godie. No install.

06:42 slash fix integrated by main: worker completion list/catalog/resource wiring; main corrected partial Enter to source-built one-step complete+submit, added /new /fork /clone, cancellation/newline/Escape menu cleanup and command-name sanitization. Real PTY found stale inline menus; fixed by real textarea cursor anchored to input row (not hidden footer cursor), no alt-screen/spacer. Focused TUI/cmd race+vet PASS. Final asserted 13-condition baseline/candidate PTY task_a0631e1e running; rebuilt binary+streaming regression task_ba804fcd finishing. Before reproduction f58fe481...; after artifacts slash-* under validation/artifacts. Need inspect manifests then final user reply, no install.

## Slash autocomplete completed — 2026-09-14 06:43 UTC

User bug fixed and rebuilt expt-go/bin/godie SHA25615fc7aee095544002dd3a3fc6d798766709745b4378d04cbda688d620928d0a4. Real tmux baseline/candidate13checks ALL PASS incl no stale rows/Enter/Tab/Escape/skills/templates/new/cancel; streaming real PTY regression also PASS both. Focused TUI/cmd race+vet PASS. See expt-go/validation/slash-completion-report.md and implementation-slash-completion.md. All slash-fix tasks finished; no install. User must restart binary. This updated binary has focused validation; previous broad final-combined hashes remain historical.

## User-authorized credential import — 2026-09-14

User asked to copy auth after missing ~/.godie/auth.json error. Main ran supported --import-codex-auth from ~/.die/agent/auth.json into ~/.godie, only openai-codex entry, destination0600; source content hash unchanged verified (no token/hash values logged). No live request performed. User warned duplicate OAuth refresh-token copies can drift/rotate; separate login is safer long term. Real ~/.godie now intentionally contains credential, unlike earlier isolated test-only setup.
