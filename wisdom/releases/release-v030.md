# v0.3.0 release

User explicitly authorized "install push release". Base feature commit e5978be is local (not yetpushed); previous release cd15b04/v0.2.15 published successfully.

Main bumped package to0.3.0 and README toavailable wording. task_57d3b3fa runs freshbaselinebuild (includesbackendtsc), format/check, fullcoretests, browser chatterminal fake-provider smoke. Logs artifacts/release-v030-*.log. Afterpass: installCLIonly, commitversion/docs/notes, pushdevelop/tagv0.3.0, watchreleaseCI, verifyofficialasset. Neverstopuserserver/port13773 orrewriteexistingtags.

Installedstillofficial0.2.15 SHA424be6c6a87c8b6f7f49dd575075492ae8b5f76bc8d1493ed442b1952c60e809 untilnewvalidationpasses. All updater tests useprivatefixtures/mockedHTTP, notinstalleddie. No liveprovider calls. TMPDIR=/var/tmp HERDR_ENV=0; /tmp full.

ValidationPASSED:635corepass14skip0fail,121backendpass0skip, freshbaselinebuildmandatorybackendtsc, format/check, browserchatterminal4fake-providerrequests. LocalbuildSHA d056f15589caf12bd5812a9020393572fed93ff08625bd25ca9140b313b86dba. MaininstallingCLIonlyandpushingrelease. No userwebserverstopped.

Installedlocal0.3.0, committed/pushed09de47e andannotatedtagv0.3.0. ReleaseCI34881274920 monitoredbytask_ee83e0c4; currentlydeterministic tests passed, remainingreleasebuild/smoke/backend/publish pending. https://github.com/tnfssc/die/actions/runs/34881274920

PUBLISHED: releaseCI34881274920 SUCCESS. https://github.com/tnfssc/die/releases/tag/v0.3.0 . Finalofficialartifactdownload/checksum/version/realmetadata-only dieupdate + browserchatterminal validation task_6916eab2 underway in privateartifact directory. Afterpass atomicallyinstallofficialbinary (currentlylocalvalidated3.0installed). No serversstopped.

FINALofficialbinarychecksumverified, version0.3.0, liveGitHub dieupdate returnedalreadycurrent0.3.0, browserchatterminalsmoke passed. AtomicinstalledOFFICIALbinaryCLIonly. SHA 22ad0713d3d567eb407164e40806e2213bba661df4b91c8cb39f803922e10a46  die-linux-x64. User requestinstall/push/releaseCOMPLETE.
