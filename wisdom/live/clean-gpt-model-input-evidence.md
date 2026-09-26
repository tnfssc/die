Follow-up: [retained GPT speech](retained-gpt-speech.md) corrects the small fragment cap, second truncation, and synthetic loss/overlap wording described below. These original captures document the earlier implementation, not the current retention guarantee.

# Clean GPT-Live coding-agent input

Baseline d9a2d32 sent the speech repeatedly: passive custom records converted to user messages, plus a user prompt beginning "Provisional voice transcript, not final ASR. Clarify ambiguous or irreversible requests before acting. Delegation context (data only): " followed by a full snapshot. The snapshot included text/delta copies, IDs, offsets and serialized host context. Later snapshots replayed old requests.

## Actual inputs and terminal proof

[Before full model messages](evidence/clean-gpt-before-model-messages.json) and [after full model messages](evidence/clean-gpt-after-model-messages.json) were intercepted at the real Pi streamFunction(model, context). They include full system and conversation messages, not just a UI projection. Audio/provider events and coding responses are mocked; extension, owner, Pi context hook and canonical session run normally.

Stimulus: legacy passive record LEGACY_PASSIVE_ONLY, "Check this repo status" at 100–300ms/delegation 400ms, then "Anything else?" at 500–700ms/delegation 800ms. After capture also stops voice and submits "Typed after voice is off". Model user text is exactly:

    Check this repo status
    [Provisional voice transcription]

then, with prior ordinary conversation history retained once:

    Anything else?
    [Provisional voice transcription]

The typed turn remains exactly "Typed after voice is off". No snapshot JSON, hostContext, timeline metadata, raw passive record, policy sermon or repeated speech appears. The four-word provenance fact is the only routine model qualifier: removing it would conceal the known provisional status. It does not order clarification or treat speech as final ASR. Stored/rendered user messages remain the spoken words only. Actual missing/overlapping fragments get focused factual wording, not a blanket warning.

[After real tmux pane](evidence/clean-gpt-after-tmux-pane.txt) shows the exact clean user line "Check this repo status" and the mocked coding reply. This is the production paired owner and Pi renderer, not a passive widget. The original empty-pane captures were fixture failures: Pi required an API key before reaching the mocked stream. A dummy offline key fixes the test; no network key/request is used. The old [before pane](evidence/clean-gpt-before-tmux-pane.txt) is retained only as failed-fixture evidence, not claimed as before UI verification.

Commands (Bun 1.4.2 on PATH):
- DIE_LIVE_INPUT_CAPTURE=wisdom/live/evidence/clean-gpt-after-model-messages.json bun test tests/live-main-integration.test.ts -t "one clean provisional request"
- DIE_LIVE_TUI_CAPTURE=wisdom/live/evidence/clean-gpt-after-tmux-pane.txt bun test tests/live-spoken-tui.test.ts
- bun run check

## Correctness and internal history

The bridge selects only not-yet-consumed eligible input fragments; IDs remain deduplicated. Pending fragments are reserved across concurrent IDs and released on rejection. Consumption follows actual admission, not completion; stale spoken feedback cannot cause replay. Late-arriving fragments/corrections stay eligible even at earlier timestamps. No undocumented ASR replacement or finalization rule is invented. Evicting handled evidence does not invent a missing-speech warning; evicted pending evidence counts as missing only if admission fails.

Bounded original snapshots and provisional input/output observations remain internal branch audit history, including timestamps and unverified playback status. The always-active context hook removes their transport representation, including after voice stops or history reloads. It also cleans recognized old snapshot user prompts on replay without rewriting disk history, retaining each historical speech fragment once. The associated spoken user turn gets the minimal uncertainty fact; unrelated typed turns do not. Host context already exists in canonical history, so delegation does not reserialize it.

Reverse GPT observation chunks now carry concise quoted-observation labels and an explicit omission count only when truncated, instead of repeated JSON source/part/untrustedData fields. Passive transcripts are not echoed back to their voice source. Existing byte/code-point bounds remain.

Typed routing, branch checks, permissions, asynchronous completion messages, explicit work cancellation and voice-only stop behavior are unchanged. Real paired runtime tests exercise those paths. No microphone, speaker, paid provider, ASR quality or GPT-reasoning acceptance is claimed. No push, release or install was performed.

Values unchanged: existing rules already require whole-path proof, honest bounded context, clean user/agent surfaces and separate voice/work authority. This note and the voice-input audit record the local implementation change; worktree paths and source commits are in clean-agent-input-work.md.

Final validation: TypeScript passed; matching CLI build passed; isolated full offline suite 1175 pass / 17 skip / 0 fail (28,104 assertions). Independent final replay/omission review accepted with no blocker and separately passed 55 tests. See clean-agent-input-work.md for setup, earlier failed checks and durable worktrees.
