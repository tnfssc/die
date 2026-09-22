# Validated T3-v2 production export — adopted

- Upstream: a9b49a7df0a4261dcc438d4493cc3154a1d9819e
- Patch SHA256: a98ba10466328f7800f0d64a1f5df88dcf290980fdeb30e80a2412e6114f7e91
- Candidate validation executable SHA256: 8e277017a3cd05d46d00bc6f563a57875ecb7793bd19fa792e4b4645e36ec0ec
- Final canonical executable SHA256: 8932d0e7561c0b79d6647c0f617ae548087e7d74bb27c740011ad245b16bb716

The export is byte-identical to canonical web/t3.patch. The ordinary local-shell
completion → next-turn failure was traced to an unowned Pi triggerTurn and fixed
with durable, idempotent T3-owned notification admission, not EOF suppression.

All concrete blocking gates passed on the final canonical executable: root 721
pass / 14 expected skips, full workspace types, native integration, same-server
browser and preservation, relocated package/security smoke, and migration/restart.
See artifacts/t3-v2-lifecycle-acceptance.json and
.agents/notes/t3-v2-production-lifecycle-final.md for exact evidence, commands,
rollback and honest broad-suite/resource limitations.

Normal canonical build (separate outfile protects an existing live dist/die):

    env -u DIE_T3_SOURCE pnpm_config_verify_deps_before_run=false bun scripts/build.ts --outfile=dist/die-t3-v2-production

Candidate helper scripts remain available for future review snapshots and label
their own outputs non-adopted. They do not overwrite canonical inputs or install
an application. No release, installation, version bump, tag, push or user state
migration was performed on a user's running installation.
