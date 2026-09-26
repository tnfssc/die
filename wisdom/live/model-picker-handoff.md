# Unified Live model picker

User rejects filtering Live models by selected provider. /live provider
should configure providers; /live model lists supported models across
providers and selects their provider automatically. Keep credentials
readiness clear without claiming actual API/model access was tested.

Implementation job task_a3d8cf19:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_a3d8cf19
branch die/decouple-live-model-picker-from-provider-a3d8cf19
base cd87a6549dae517ac166ba0c1c5a6beccdc5d645.

Combine with persistent questions, GPT transcript and native audio fixes
for next user-approved release. No release before merged surface review
and gates. Keep labels concise, no extra subtitles. Credential setup
retains normal consent and storage; selection must not open mic or socket.

Values read earlier; user/model surfaces and honest readiness are covered
by existing values. Recheck after implementation.

Original worker stopped (exit 143) after 20 minutes without new tool output.
Draft preserved at original tree model-picker-draft.patch. Its focused
Live test log reports 261 passed, 3 skips, but final review was unfinished.
Replacement task_4c542233:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_4c542233
branch die/finish-and-verify-unified-live-picker-4c542233
base e6242a75a925e399fa7e286f11226616c87b90ce.
It will review/apply draft and finish actual picker proof and commits.
