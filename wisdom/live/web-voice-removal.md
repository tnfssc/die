# Web Live voice removed (post-v0.12.0)

The user rejected released browser Live voice and requested CLI-only voice. This is removal, not a hidden toggle. v0.12.0 release notes remain historical. The web-port notes describe superseded designs. CLI Gemini, OpenAI Realtime and GPT-Live choices and CLI cost events/footer remain.

The maintained T3 patch was restored byte-for-byte from pre-web-voice commit 1d251740a51e1a81c104288f1a6e41f324a543c9. Comparison showed only web voice transport, routes, controls, tests and generated patch indices added since that commit, not unrelated patch changes. Revert only feature-only host leases and multi-owner lifecycle dispatch; keep unrelated session and web functionality. Keep the generic CI binary-path fix. Remove web-specific release/CI gates and browser capture fixtures; generic web gates remain.

Verification: tests/no-web-voice.test.ts guards the maintained patch and CLI model choices. Run CLI cost/provider/session tests and typecheck. Validate applied patch from clean pinned T3 checkout, never feature-mutated cache. No paid calls. Parent owns release, version bump, push and tag. Values unchanged: preservation, honest evidence and testing shipped copies already cover this decision.

Observed offline: clean pinned checkout at /tmp/die-no-web-voice-yoAsrO cloned from local pinned Git object store (not the feature-mutated worktree), restored to b488c57f3f9f1688e31c53daee99e29dd1d0baa2, accepts the restored maintained patch via git apply; scanning 2,509 server/web source files finds no web voice route/control/IPC markers. Root format:check, lint, typecheck and 128 targeted CLI/session/patch assertions pass. Packaged web binary not built here; parent full CI must exercise its packaged web gates.
