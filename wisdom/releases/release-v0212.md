# v0.2.12 release underway

Follow-up to unpublishedv0.2.11: move T3buildcache outside node_modules to avoid Node type-stripping refusal. User authorized push/release/install. Package bumped0.2.12; task_c9534fb7 owns helper/workflow/gitignore + actualfreshdefaultbuild, task_4cc19a47 corecheck/build/tests. Wait results, validatefreshbackend, commit/tag/push (nevermovev0.2.11), watchrelease, installpublishedCLI+sidecar and realbrowserverify. CurrentinstalledCLI0.2.11 with testedlocalbackend, unchangeduserstate.

Freshdefaultbuild passed (DIE_T3_SOURCE unset) under .cache/die-t3code; reversepatch checkpassed and351symlinks internal. Core610pass14skip0fail, format/lint/check/build pass. Updated matching defaultsmoke sourcecache path. Ready commit/tag/push0.2.12; v0.2.11 remainsunpublished/tagunchanged.

Pushedcommit882fd527f4a35e46a1d00be91d87bc6a0f3bb665 +annotatedtagv0.2.12. Release run34850093931 inprogress. Watchthen download/verify/installpublishedCLI+webbundle and realbrowserStop/modelchecks.

## Published and installed successfully
Release https://github.com/tnfssc/die/releases/tag/v0.2.12 . Release workflow34850093931 passed; both code CI runs for882fd527 also passed. Downloaded publishedCLI+webbundle, verifiedchecksums/SOURCE and351internal symlinks, installedboth under~/.local/bin. InstalledCLI reports0.2.12, SHA2569b439c6a6f248c2ce81306f485f0540392e84d3e505aa5ad770cfc29fc73ae7b; webarchiveSHA256e972a0a8748f5d885f9b9e350d6995ee7218afc5a2a0b0932d62d7cd1789f15d. Publishedartifacts passed realbrowserStop(task_383205c6) and model/no-auth/origin(task_bedbd24e) checks. Shell receivedTERM andPIDdisappeared; backgroundsubagent streamaborted; follow-uphistory preserved. Backupremoved aftersuccess. User servers untouched; restartdie web toloadupdate. Releasebody includeswebhighlights/runtimeNode24 requirement. v0.2.11 tag remainsunpublished, supersededby0.2.12.
