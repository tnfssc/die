# v0.2.15 preparation

- v0.2.14 failedCI34873549248; tagimmutable, neverpublished. Installedlocal0.2.14 remains functional.
- Fix BunPtyAdapter constructor parameterproperties to explicitfields. Backend tests use Effect NodeServices/ChildProcessSpawner to spawn Bun from Node-hosted Vitest, scopedasync filesystem, Schema decoding.
- Main rejected firstworker fix (alwaysskipped under Node + async fs runSync), secondworker report (called3newerrors preexisting suggestions). MainfixedSchemaJSONdecoder and unsupported it.skipIf().effect typing; requiresBun on supportedLinux project. Exact backendtsc exit0; 14PTY tests pass0skip. Logs /var/tmp/bun-pty-main-{tsc,tests}.log.
- Main adds exact backendtsc to buildWeb beforepackaging and PTY tests to CI/release backend suite. Package/README0.2.15; patchrecaptured alltracked+untrackedapps/packages afterformatter, reversecheckpassed.
- Main task_abecda36 running fullfreshbaselinebuild (notreuse), corechecks/tests and browserchatterminal. Artifacts release-v0215-*.log. No tag/commit/install for0.2.15 yet.

Main final validation PASSED: fullfreshbaselinebuild withmandatory backendtsc,616corepass14skip0fail; exactCI backendtsc exit0 +121tests5files0skip0fail; integrated browser chatterminal4fake-providerrequests passed. Finaldist/die SHAef42d450d7cefbcd39a51ff99c0a30d1ee562cbcb50b528d4c79fe7c1ff90754; canonicalpatch69edbd0881a5b6c6d03d905dcba52b8e8894e91d9ccd64125c09baf48478043d. Main nowinstallinglocalCLIonlyandcommitting/tagging0.2.15. Existinguserwebserveruntouched.

PUBLISHED: releaseCI34876404085 SUCCESS, tagv0.2.15 atcd15b04. https://github.com/tnfssc/die/releases/tag/v0.2.15 . One executable pluschecksum/source/licenses; no sidecar. Main nowdownloads/verifiesofficialasset for finalsmoke. Userrequestedupcoming0.3.0 die update; task_b7bb41dc owns updaterfiles/tests/docs, no versionbump/release/install yet.

Officialassetdownloaded/checksumverified, --version0.2.15 and integrated browser chatterminalsmoke passed (artifacts/official-v0215-browser.log). AtomicinstalledOFFICIALreleaseCLIonly; SHA 424be6c6a87c8b6f7f49dd575075492ae8b5f76bc8d1493ed442b1952c60e809  die-linux-x64. Existingserversunchanged.
