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
