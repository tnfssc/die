# Live provisional transcript in the web projection

GPT-Live emits JSON fragments from src/live/extension.ts with customType "live-transcript". The main owner persists them through sendCustomMessage / appendCustomMessageEntry (src/live/main-owner.ts); this is deliberate history for the coder, not a user utterance. Pi RPC get_messages returns these as role "custom".

The pinned web adapter apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts (shipped via integrations/t3/upstream/die.patch) reads active-branch get_messages in readThreadSnapshot and only projects roles "user" and "assistant". Its event pump likewise only streams assistant deltas, and never streams custom records. Therefore the canonical web projection already excludes these fragments, while still projecting coding responses and preserving original Pi history. Added a regression fixture to its snapshot test to protect that distinction. Do not suppress backend transcript entries or coding outputs to fix a display symptom. A JSON flood observed in a running UI needs the actual deployed build/version and a captured transport event to locate another path; no production code change is justified on the pinned path alone.

Values unchanged: truthfulness (#8), no quiet loss (#5), and smallest justified fix (#7) already cover this case.
