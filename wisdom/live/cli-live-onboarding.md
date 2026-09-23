# CLI Live onboarding

## Ownership / review

Feature worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d6c2c213
Branch: die/build-cli-live-onboarding-wizard-d6c2c213
Parent review required before merge; this work does not integrate the parent workspace.

Independent slices:
- Credentials: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d6c2c213-a86675007a5e-task_d0cfbf62, branch die/safe-live-provider-credentials-d0cfbf62.
- Wizard: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d6c2c213-a86675007a5e-task_7da14b73, branch die/terminal-live-setup-wizard-7da14b73.

## Design

Use existing terminal select/confirm/notify dialogs, not a web flow or persistent setup state. Opening setup must not start a connection or audio. The existing compact Live status line, configured coding agent, NON_BLOCKING handoff, and concurrent audio/agent loops stay unchanged.

Pinned Pi 0.87.1's LoginDialogComponent uses ordinary Input and replaces submitted input with visible Text. Its extension UI input has no masking contract. Therefore Live setup uses secure local-file entry in an external editor, never ordinary key input. No secret belongs in a chat, tool invocation, shell command, transcript, notification, or error.

The optional paid test creates the existing LiveTransport with inert callbacks, sends only its setup handshake, and closes immediately on setupComplete. No audio adapter, user input, bridge, handoff dispatch, retry, or speaker playback exists in that path. A 15-second deadline, session lifecycle abort, and static errors bound failure. A successful handshake is not proof that a physical device works or that a subsequent session is free.

## Evidence and limitations

All task validation is offline using fake keys, temporary storage, fake sockets, and fake devices. No real credential was read by tools, no paid API call was made, and no microphone or speaker was opened. Tool/platform discovery cannot prove default device availability, permissions, latency, or echo behavior; those remain explicit-start acceptance work. The existing Linux-only/no-SSH and headphones/no-echo-cancellation limits remain.

## Values assessment

Applies existing values: complete the user flow, one cleanup owner, preserve unrelated credentials/work, simplest existing UI, and state what checks actually prove. Values remain unchanged; this is feature-specific evidence rather than a new general rule.

## Exact setup flow and migration

1. /live → Setup / review (first menu item), or /live setup directly. Local-root interactive TUI only. Active Live asks the user to stop first; duplicate setup is refused.
2. A review explains local default mic/speakers, Google audio and selected confirmed current-session reply sharing, paid provider use, headphones, and no echo cancellation. A select dialog shows key state and audio-tool readiness, explicitly “devices untested.” Checks inspect Linux/SSH and executable presence, not devices.
3. Existing Google API-key metadata or ambient GEMINI_API_KEY is reused. No key is displayed. Existing Google OAuth is shown as incompatible and preserved. Users manage existing provider auth separately; this wizard never rotates or overwrites it.
4. Missing Google auth offers secure-file instructions and Import. The user privately edits ~/.die/live.env outside the agent, owns the regular nonsymlink file, and sets mode 0600 before entering one literal GEMINI_API_KEY assignment. This wizard never offers ordinary text/secret input. Import separately confirms the read and persistence. Missing/unsafe/invalid files produce static retry guidance. The file is left in place; imports are never automatic.
5. Explicit import writes {type: api_key, key} for google into the existing canonical auth.json through AuthStorage.modify, with the no-existing-credential condition checked **inside its lock**. Every other provider and OAuth entry stays untouched. Concurrent writers cannot have their Google entry replaced. No custom auth file format or second permanent store is added. The legacy file is now an import source, not the default start fallback; users with old setup must explicitly import once. Ambient keys are not copied to disk.
6. A configured key enables the optional “Test paid connection (no microphone or speakers)” action. A second confirmation precedes the setup-only handshake, bounded to 15 seconds. It is optional and success never automatically starts Live. It remains available when audio tools are missing because it does not use them.
7. Configured key plus available audio tools enables Start Live. A final review confirms paid Google use and opening the default mic/speakers. Done/Escape exits without starting anything. Back from file instructions returns to the menu. Refresh handles external edits and failed checks. Stop/session replacement/shutdown abort setup tests; agent work continues.

## Credential API findings and integration correction

Pi 0.87.1 exports ModelRuntime but does not re-export AuthStorage at its package root. Its pinned dist/core/auth-storage.js module supplies canonical locking and modify APIs. A static relative import bundles that existing class; there is no replacement JSON writer. The factory uses DIE_CODING_AGENT_DIR/auth.json, or ~/.die/agent/auth.json, matching die’s normal storage location. A stock Google ModelRuntime is created only on explicit setup/start use, with modelsPath:null, refreshOnCreate:false, allowModelNetwork:false. It is credential resolution only, not a replacement coding agent/session; the existing configured agent is untouched. Stored-key status uses listCredentials metadata without resolving command references; explicit start/test loads via getAuth("google").

Review found the worker’s initial ModelRuntime.login implementation still had a cross-runtime race: login unconditionally replaces a credential after a prompt-time recheck. The integrated code instead calls the **existing** CredentialStore.modify under AuthStorage’s lock. Offline tests inject an intervening OAuth write and exercise concurrent imports. This is why serialized runtime login alone is not sufficient for migration. Recheck the private static import and these lifecycle tests when upgrading pinned Pi.

Secure source reads additionally use O_NOFOLLOW|O_NONBLOCK, verify file type/uid/exact mode/size, cap bytes read at 16 KiB, and close the descriptor in finally. This avoids FIFO waits and unbounded reads. No source/key/raw provider exception appears in wizard errors.

## Validation

- 112 offline tests passed, 1 explicitly paid provider acceptance skipped, 0 failures across 15 files: Live auth/wizard/test/extension/transport/bridge/status/dispatch, audio, footer, prompt delivery, subagent extension, and last-used model regressions.
- Whole-repository bun run check passed (including asset preparation).
- Bun bundled the Live extension with the private AuthStorage static seam: 1,972 modules; no runtime network or device call.
- Changed-file Biome formatting and git diff --check passed. Biome check has no errors; existing-style non-null assertion/test-any warnings and informational suggestions remain.
- Shell startup reports untrusted mise.toml; used the installed Bun 1.4.1 absolute path without changing trust.
- Full application build, full repository/web suite, and physical interactive terminal/device acceptance were not run.

## Independent review disposition

Read-only review task_87f0e3e5 ran in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_d6c2c213-a86675007a5e-task_87f0e3e5 (branch die/review-live-onboarding-safety-87f0e3e5). It confirmed consent/secret/atomic-write boundaries. Its checkout lacked installed dependencies, so its credential/extension suite load failures were environmental, not reproduced after the orchestrator's frozen-lockfile install.

- Private AuthStorage import risk: retained deliberately because ModelRuntime.login cannot implement atomic no-overwrite migration. The module is pinned, typechecked, bundled, and a standalone Bun-compiled **executable** probe successfully created temporary canonical storage, imported a fake secure-file key, resolved it via ModelRuntime, and cleaned up. No installed node_modules are needed by that artifact. Probe command: bun build /tmp/die-live-auth-probe.ts --compile --outfile /tmp/die-live-auth-probe; then execute it. Full die binary packaging remains untested here.
- Cancellation: signals now propagate through credential status, key resolution, ModelRuntime creation, and locked import. Tests cover already-aborted inspection/factory and abort immediately before persistence. Native AuthStorage's synchronous construction/initial lock cannot itself be interrupted mid-call; existing bounded native locking remains its owner. Lifecycle guards prevent any late network/audio start or stale wizard UI.
- Final regression command: env -u GEMINI_API_KEY -u DIE_RUN_GEMINI_LIVE_ACCEPTANCE bun test tests/live-*.test.ts tests/audio.test.ts tests/footer.test.ts tests/prompt-delivery.test.ts tests/subagent-extension.test.ts tests/last-used-cli-model.test.ts. Result: 112 pass, 1 paid acceptance skip, 0 fail, 543 assertions across 15 files.

Parent review is still required before merge. No parent integration was performed.
