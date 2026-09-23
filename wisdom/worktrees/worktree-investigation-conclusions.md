# CLI-first worktree investigation conclusions
On 2026-09-21, the investigation finished with no product changes. It used adopted source a9b49a7d, the canonical patch, and root CLI source. Git fixtures ran only on Linux. All four research jobs finished.

Reports used:
- worktree-setup-config-investigation.md
- worktree-cli-lifecycle-investigation.md
- worktree-web-integration-investigation.md
- worktree-git-safety-investigation.md

Facts and corrections:
1. Repo-root t3.json ALREADY exists; JSONC, scripts declarations incl name/command/runOnWorktreeCreate/async. Lead verified schema and Import from t3.json UI directly. Persisted/imported T3 actions are local settings.json (projectSettingsOverrides/defaultProjectScripts), not generally repo or canonical SQLite; legacy DB fields migrated. Merely placing t3.json does not auto-run script: explicit UI import is important consent property. Current setup selection first flagged script; async defaults true (child can start before setup ends), false waits and failure blocks prepared startup. Do not invent second incompatible schema or assume web UI actions portable automatically.
2. Native delegation now inherits parent branch/worktree; it does NOT invoke ThreadLaunchService. Ordinary ThreadLaunchService cannot create delegated lineage nor reuse already populated child. Web solution must keep delegated_task.request as graph/result owner, defer child run, and factor reusable workspace preparation for that existing child. Don't create a second ordinary thread then pretend it is same task.
3. CLI uses Git directly and normal local TaskManager child, never boots/reads T3 service DB. Thin mode-specific prep drivers with common contract preferable to bundling Effect/server/DB in CLI. CLI prep belongs to visible job lifecycle before child spawn; starting a worktree may take time, result must distinguish preparing/setting-up/running/failure.
4. Five local concurrent worktrees from one pinned commit verified (LinuxGit2.54). Dirty parent tracked changes/untracked.env not copied; detachedHEAD works; collisions reject; submodules not populated automatically and complicate cleanup. No cross-platform proof, bare repo only basic fixture not supported product claim.

Recommended API (proposal): workspace:{kind:'inherit'} default OR {kind:'worktree',baseRef?,branch?}, plus title?; no arbitrary cwd/path/raw setupCommand or model-passed approval boolean. baseRef defaults explicit documented sourceHEAD, resolve commit once for batch. Branch names generated server/local trusted owner; explicit branch only single launch or per-child distinct spec, never reset/reuse existing branch. API must expose resolved cwd/branch/baseOID/workspaceId/prep status.

Setup portability/consent proposal:
Use t3.json existing schema as portable declaration, user explicitly imports/approves exact setup command+policy for CLI, held outside repo keyed canonical common-dir and digest. Web continues honoring already user-configured selected T3 action; to share UI-only action with CLI offer explicit export/import into repo declaration or explicit local Die config (no silent T3settings reads). Approval is USER authority, never an agent argument. Changed config requires renewed approval. Missing config means no setup reported explicitly; declared-but-unapproved setup must surface approval requirement, not silently run or silently call workspace ready. Resolve source config snapshot before preparation and record digest; uncommitted workspace contents not copied.
Respect selected setup async flag; recommend async:false for dependency setup users want awaited. Do not claim script side effects exactly once after crash: durable attempt record+positive completion receipt; uncertain in-progress setup requires explicit retry, no automatic blind rerun. Existing T3 runner lacks general once-per-worktree durable receipt.

Resource/safety policy:
Allocate persistent worktree under managed external state directory, not tmp or source checkout; IDs unique and stable per launch. Manifest before Git side effects, reconcile exact path/ref/commit/common-dir on retry. Git argv shell:false, validate ref via Git, --no-track -b newbranch, never -B/reset/force/remove broadly. No copying.env/credentials/ignored files. Setup process uses existing bounded capture and owned group cancellation; role/model/trust/instructions use child cwd and explicit session ancestry/cost root. Cancellation stops owned processes but preserves worktree+branch; explicit cleanup later, never globally prune or delete uncertain/untracked/ignored/submodule work. Bound in-memory active state/logs; intentional retained disk workspace not memory leak.

Validation before feature enabled:
FiveCLI worktrees with T3 executable/server absent, unique branches same baseOID, setup cwd/env/receipt correctness; existing web config wait/background/no-script behavior; denied/changed trust; collisions/concurrent retry; crash during Git/setup and no destructive recovery; cancel during prep/setup/child, no orphan descendant; partial batch prep failure isolated per returned task; local wait/deadline accounting includes prep; native branch retains lineage/one result owner and no run before requiredsetup; CLI history/cost/memory/trust regression; packaging and byte/resource bounds.

Separate future features (not built by workspace flag): ordinary sidebar subagent grouping/visibility, continuous parent latest-result sync after user directly follows up child, and PR-specific lifecycle. Current direct child chat supported but original delegated result is one-shot.
