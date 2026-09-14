# v0.2.12 release underway

Follow-up to unpublishedv0.2.11: move T3buildcache outside node_modules to avoid Node type-stripping refusal. User authorized push/release/install. Package bumped0.2.12; task_c9534fb7 owns helper/workflow/gitignore + actualfreshdefaultbuild, task_4cc19a47 corecheck/build/tests. Wait results, validatefreshbackend, commit/tag/push (nevermovev0.2.11), watchrelease, installpublishedCLI+sidecar and realbrowserverify. CurrentinstalledCLI0.2.11 with testedlocalbackend, unchangeduserstate.

Freshdefaultbuild passed (DIE_T3_SOURCE unset) under .cache/die-t3code; reversepatch checkpassed and351symlinks internal. Core610pass14skip0fail, format/lint/check/build pass. Updated matching defaultsmoke sourcecache path. Ready commit/tag/push0.2.12; v0.2.11 remainsunpublished/tagunchanged.
