# Unified Live picker — actual terminal release evidence (2026-09-26)

Ran source CLI `src/cli.ts` in a tmux PTY at 80 and 120 columns (40 rows), using `tests/live-picker-tui.test.ts` and `tests/fixtures/live-picker-tui.ts`. Prepared runtime assets with `bun run prepare:assets` and temporarily symlinked this worktree's ignored `node_modules` to the parent checkout. No upstream rebuild, release, installation, push, mic, or provider socket. The fixture uses the **real Live extension and Pi select renderer**, supplies only local credential statuses (Google OAuth, OpenAI stored API key) and in-memory config, and throws on key/audio/session attempts. It registers the injected extension under `/livepicker` to avoid colliding with the CLI's bundled `/live`; the handler and option generation are the production source. These are real terminal frames, not UI-select callback captures. We set tmux's shell to `/bin/sh` to avoid an unrelated worktree mise trust warning in the rendered pane.

At **80 columns**, the actual `capture-pane` (the 120-column frame has the same complete labels, with longer horizontal rules):

```text
────────────────────────────────────────────────────────────────────────────────

 Live voice model

 → gemini-3.8-live · Google Gemini · API key needed (OAuth) (selected)
   gemini-3.8-live-extended-thinking · Google Gemini · API key needed (OAuth)
   gpt-realtime-2.1 · OpenAI · key configured
   gpt-realtime-2.1-mini · OpenAI · key configured
   gpt-live-1 · OpenAI · key configured

 ↑↓ navigate  enter select  escape/ctrl+c cancel

────────────────────────────────────────────────────────────────────────────────
```

All five full model IDs and readiness tags fit on one line at 80 and 120; no subtitle or redundant explanation occupies the picker. The selected marker initially appears on Google base. Navigating to and selecting `gpt-live-1` renders `Live voice: OpenAI · gpt-live-1`; reopening the picker renders `gpt-live-1 · OpenAI · key configured (selected)` while all five options remain visible. Selection never starts voice. The provider screen separately renders:

```text
 Configure Live provider credentials

 → Google Gemini
   OpenAI
```

Choosing OpenAI renders only `OpenAI API key configured → Done` (no Start voice). After Done, actual terminal status reads `Live off · OpenAI voice model gpt-live-1. Coding-agent model is configured separately.` Thus provider setup did not filter the model list, replace the chosen model, or launch voice. The standalone `/live start`/`/live setup` consent flows were not exercised here.

Readiness is **local credential state**, not verified access to an API: production `createLiveCredentialService.status()` accepts an OpenAI key only when stored under the canonical `openai` provider, not ambient `OPENAI_API_KEY`, `openai-codex` OAuth, or subscription; Google OAuth maps to `API key needed (OAuth)`, and a stored/configured Google API key maps to `key configured`. This capture injects those statuses; it does not establish actual billing/entitlement.

Verification: `bun test tests/live-picker-tui.test.ts tests/live-extension.test.ts tests/live-setup.test.ts tests/live-config.test.ts` — **71 pass, 0 fail, 375 assertions**; `tsc --noEmit` passed. Bun 1.4.2, shared node_modules. No questions files changed. The earlier handoff's SSH failure concerned full build and did not block this source CLI PTY route.
