# Same voice across repo

## Request and stack

User asked to rewrite existing wisdom and other repo prose in the same short, plain voice, with agents working in parallel. Stack this on PR #2, not straight onto develop.

- Main checkout: /home/tnfssc/Code/die
- Branch: style/plain-project-prose
- Base: feat/derived-wisdom-values at 3054e14
- No install, release, or merge asked for.

## What got a pass

Reviewed all **266 repo-owned Markdown files** present at the base. Changed 248. The other 18 already fit or are short records best left as they are. This file is new.

| Area | Reviewed | Changed |
| --- | ---: | ---: |
| T3 wisdom | 59 | 59 |
| Resources | 33 | 33 |
| Worktrees | 21 | 21 |
| Memory, history, prompts, models, goals, integrations, experiments, wisdom system | 31 | 24 |
| Web, native, task UI, execute | 35 | 35 |
| Releases | 33 | 33 |
| Packaging, CI, dependencies, quality | 14 | 14 |
| Root guides, script guides, experiment reports, authored third-party guide | 24 | 24 |
| Runtime prompt Markdown | 15 | 5 |
| Values from PR #2 | 1 | 0 |
| Total | 266 | 248 |

Also changed narrative comments in 54 source, test, script, and experiment files. Support bootstrap comments already fit. Workflows had no narrative comments to rewrite. Prompt tests changed only where they check new wording.

Keep exact facts, limits, dates, IDs, paths, links, and test claims. Keep old reports as old reports. Leave code, commands, literal quotes, captured logs, fixture strings, generated files/patches, legal text, and upstream text alone. Runtime help, errors, labels, and schema strings stay exact as code/output contracts. This is not a claim that every string inside code was rewritten.

The two excluded Markdown files are THIRD_PARTY_NOTICES.md (generated legal notices) and third_party/bun/LICENSE.md. LICENSE and other non-Markdown legal files also stay untouched. third_party/README.md is our guide, so it got a pass.

## Review and repairs

Several first passes only changed words or line breaks. Sent them back for real sentence rewrites. Parent read samples from every batch and checked the pieces fit.

A worktree worker restored inline-code spans by position after moving sentences. The token list matched, but an API name landed in the wrong sentence. Another agent checked all 21 worktree docs against the base and fixed the meaning in 13. Parent checked that repair. Matching words is not proof of matching meaning.

Parent also restored exact API/file/event name case where a sentence split had capitalized names such as client.close, sendTurn, jobs.stop, models.json, and calculateCost. Kept live/background job IDs explicit in compaction guidance, timeout ownership exact in its source comment, and heap claims scoped to heap. Restored six old headings so links keep working. Added code formatting is fine only when names and meaning stay the same.

## Checks

- Full build and tests passed: 723 pass, 14 opt-in skips, 0 fail; 4639 assertions, 737 tests across 100 files. No paid-provider run. Later changes were prose only.
- Final focused prompt/SDK/preview/delivery/provider run: 30 pass, 276 assertions.
- Typecheck and full format check passed. Diff whitespace check passed.
- Parent compared Bun-transpiled output for all 49 changed JS/TS comment files: identical. Worker checked the other five scripts with comments removed: no executable change.
- Fenced blocks, commands, headings, inline names, and links were checked against each worker's base and the stack base. Added formatting is not treated as a meaning change; changed referents were repaired, not waved through.
- Local-link/anchor check against base found no new errors in the first joined set (250 links; 51 old issues). Rerun on final commit before opening PR.

Read-only final sample review task_e0b91ea5 is still outstanding. Integrate any real findings, rerun final protected-text/link checks, commit parent repairs, then push and open the PR with base feat/derived-wisdom-values.

## Worktrees left for follow-up

Each worker had its own files. All worktrees remain. Earlier commits plus deeper passes were brought in together after review. No worker pushed or opened a PR.

- T3 wisdom A: task_7a0d5c3f. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7a0d5c3f. Branch: die/plain-voice-t3-wisdom-a-7a0d5c3f.
- T3 wisdom B: task_916d94bc. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_916d94bc. Branch: die/plain-voice-t3-wisdom-b-916d94bc.
- Resource wisdom: task_463a7dae. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_463a7dae. Branch: die/plain-voice-resource-wisdom-463a7dae.
- Worktree wisdom: task_044c2790. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_044c2790. Branch: die/plain-voice-worktree-wisdom-044c2790.
- Memory and collaboration wisdom: task_5f7c592b. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5f7c592b. Branch: die/plain-voice-memory-and-collaboration-wis-5f7c592b.
- Web and native wisdom: task_6b9e54bc. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6b9e54bc. Branch: die/plain-voice-web-and-native-wisdom-6b9e54bc.
- Release wisdom: task_0f9668b5. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_0f9668b5. Branch: die/plain-voice-release-wisdom-0f9668b5.
- Delivery and quality wisdom: task_8f23a39f. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8f23a39f. Branch: die/plain-voice-delivery-and-quality-wisdom-8f23a39f.
- Repository guides and reports: task_c440ce0f. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_c440ce0f. Branch: die/plain-voice-repository-guides-and-report-c440ce0f.
- die agent [normal]: Plain voice: runtime prompts: task_82b87c45. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_82b87c45. Branch: die/plain-voice-runtime-prompts-82b87c45.
- die agent [normal]: Plain voice: source comments and help audit: task_22f00e80. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_22f00e80. Branch: die/plain-voice-source-comments-and-help-aud-22f00e80.
- Resource voice second pass: task_5378cbbb. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5378cbbb. Branch: die/deep-plain-voice-rewrite-resources-5378cbbb.
- Web/native voice second pass: task_8071273f. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8071273f. Branch: die/deep-plain-voice-rewrite-web-and-native-8071273f.
- Guides/reports voice second pass: task_af8d1583. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_af8d1583. Branch: die/deep-plain-voice-rewrite-guides-and-repo-af8d1583.
- T3 production voice second pass: task_792e9bc3. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_792e9bc3. Branch: die/deep-plain-voice-rewrite-t3-production-792e9bc3.
- Worktree voice second pass: task_6d53a1d3. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6d53a1d3. Branch: die/deep-plain-voice-rewrite-worktree-wisdom-6d53a1d3.
- T3 research voice second pass: task_dde66f47. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dde66f47. Branch: die/deep-plain-voice-rewrite-t3-research-dde66f47.
- Memory/collaboration voice second pass: task_5566346e. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5566346e. Branch: die/deep-plain-voice-rewrite-memory-and-coll-5566346e.
- Worktree semantic repair: task_5a5460c6. Path: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5a5460c6. Branch: die/repair-worktree-prose-meaning-after-toke-5a5460c6.

Disposable check scripts: /tmp/die-check-prose.ts compares fenced blocks, inline code, link targets and headings for a git range. /tmp/die-check-doc-links.ts compares local link/anchor errors against base. /tmp/die-prose-workers.json holds the worker list too. Git history and the paths above are the durable record; no need keep temporary probes forever.

## Wisdom and values

Wisdom now uses the same voice as the prompts. Values reviewed. Same-voice guidance and the value about claims matching proof already cover what this pass taught us. No new value needed. Keep checking meaning, not just whether a file or token count changed.
