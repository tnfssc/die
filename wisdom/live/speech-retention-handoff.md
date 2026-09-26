# GPT speech retention and synthetic user text

User reports visible "Earlier speech was not retained; this is the
captured portion:". It comes from gpt-live-request.ts omittedFragments
or >4096 request chars. Bridge retains only32 tiny fragments/6000 serialized
chars, so premature eviction must be checked. Need fix normal retention
and no manufactured warning prose in user turns; real loss handled
separately and must not masquerade as complete user authorization.

Task task_c71a0637:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_c71a0637
branch die/fix-lost-speech-wrapper-and-premature-tr-c71a0637
base c08e1714472a26a3bc4db92f03ea238366e996c9.
Broad audit task_b9632b21 gets coordination note to avoid duplicate edits.
Realtime cap task_0e7084af is independent. Parent reviews pieces together.
No publish/install for this followup yet. Existing surface and honest
evidence values apply; do not turn loss into a policy sermon.

Worker f135400 integrated 2f59f92. Replaces 32-fragment limit with bounded
64 KiB UTF-8 evidence budget, removes second 4096-char clipping and
manufactured user prefixes. Genuine missing speech refuses partial
dispatch and requests repeat separately. Overlap/provisional facts remain
separate model context, never fabricated user words. Prior completed
speech not repeated. Parent typecheck + focused bridge/request/replay/
real tmux tests pass; worker321 pass/3 skips. No paid/acoustic proof.
Broad surface audit still pending; no release/install yet.

Parent combined full gate passed1194 tests/17 opt-in skips/zero failures.
Fresh CLI/web build, web suites, typecheck/format/lint/smoke pass. See
surface-clutter-audit.md for scope and limits. Not pushed/released yet.
