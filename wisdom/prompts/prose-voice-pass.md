# Same voice across repo

## Work started (2026-09-23)

User asked to stack a whole-repo prose pass on PR #2 and use agents to move fast. New branch: style/plain-project-prose. Base branch: feat/derived-wisdom-values at 3054e14. Main checkout: /home/tnfssc/Code/die.

Use the voice in src/prompts/system.md and src/prompts/wisdom.md. Short words. Short sentences. Plain talk. Meaning comes first. Keep facts, caveats, dates, IDs, paths, links, and test claims. Leave code, commands, quotes, captured logs, generated files, legal text, and upstream text alone. No new product rules. Keep old reports as old reports.

## Jobs and worktrees

Each worker owns a separate set of files. All start from the same base commit. Parent owns this note and checks the pieces fit. Worktrees stay on disk so another agent can pick work up.

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

## Still to do

Bring each reviewed commit into style/plain-project-prose. Check all owned prose got a pass; say what stayed unchanged and why. Check fenced blocks and link targets against base. Review changes for lost meaning. Run prompt/SDK/preview tests if prompt text changed, format and diff checks. Source comment edits must leave executable tokens unchanged. Then push and open PR with base feat/derived-wisdom-values, not develop. No install, release, or merge asked for.

## Values check

This applies the same-voice lesson already added to the standing prompt and wisdom. No new value needed. At finish, record what changed and any scope left open.

## Review follow-up

Resource first pass 4cdb0a8 kept facts and protected text, but still sounded too formal. Not accepted as finished. Second pass task_5378cbbb owns resource prose in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5378cbbb, branch die/deep-plain-voice-rewrite-resources-5378cbbb, based on 4cdb0a8. Need real sentence rewrites, not word swaps.

Web/native first pass 138dc05 mostly reflowed unchanged formal sentences. Not accepted as finished. Second pass task_8071273f in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8071273f, branch die/deep-plain-voice-rewrite-web-and-native-8071273f, based on 138dc05. Check original inline-code tokens as well as voice.

Guides first pass a55aef1 improved README, but PRODUCT.md and long reports still need sentence-level work. Follow-up task_af8d1583 in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_af8d1583, branch die/deep-plain-voice-rewrite-guides-and-repo-af8d1583, based on a55aef1.

Prompt pass 5d41da0 accepted and brought in. Parent kept live/background job IDs explicit in compaction wording. T3 B first pass 622f104 keeps too much formal prose. Follow-up task_792e9bc3 in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_792e9bc3, branch die/deep-plain-voice-rewrite-t3-production-792e9bc3, based on 622f104.

Worktree first pass c348a22 still too formal. Follow-up task_6d53a1d3 in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6d53a1d3, branch die/deep-plain-voice-rewrite-worktree-wisdom-6d53a1d3, based on c348a22. Check original inline-code names and ordering facts.

T3 A f6efc1a accepted after sample review of execution ownership prose. All 30 files reviewed/changed. Fences, headings, inline-code tokens and link targets match base. Prompt pass 5d41da0 reviewed all 15 prompt files and changed five; the rest already fit.

Wider T3 A review: first paragraphs improved but 99 changed lines across 30 long files is too narrow for whole voice pass. First commit brought in, but final acceptance waits for deeper pass task_dde66f47 in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dde66f47, branch die/deep-plain-voice-rewrite-t3-research-dde66f47.

Delivery/quality 448a777 and source comments f60c443 accepted and brought in. Comments worker changed 54 files; AST/non-comment checks found no executable change. Parent kept foreground timeout wording exact. Delivery link check found only one new Markdown wrapper around the same existing Blacksmith URL; target unchanged. Added inline-code formatting keeps names, not new behavior. Runtime help/errors, labels, schema strings, test fixture strings, generated patches, and raw logs stay exact as code/output contracts. Support bootstrap comments already plain; unchanged.

Memory/collaboration first pass 0457463 changed mostly introductions and skipped formal guide prose. Follow-up task_5566346e in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5566346e, branch die/deep-plain-voice-rewrite-memory-and-coll-5566346e. All original 31 owned docs need review; this handoff file stays parent-owned.

Release e86786e accepted after review. All 33 files changed; same dates, hashes, URLs, results and chronology. Bare technical names got inline-code formatting in a few places. Restored exact `passed: true` proof field in packaging note during parent review. Typecheck and full format check passed on joined prompt/comment/source work. Full build/test job task_a068532b running.

Parent also compared Bun-transpiled output before/after the comments commit for all 49 changed JS/TS files: identical. Worker checked the other five script files without comments: identical executable content. Support bootstrap already uses plain comments. Remaining jobs are deeper prose passes, not product-code changes.

Web/native second pass 1b181c6 accepted after checking full paragraph rewrites and preserved fields. Brought in 138dc05 then 1b181c6. All 35 docs changed across both passes. Fences, links, quotes, and inline-code tokens unchanged in second pass; original inline changes were added formatting around existing names.

Full build and suite passed: 723 pass, 14 opt-in skips, 0 fail, 4639 assertions (737 tests / 100 files). No live paid-provider run. Parent restored four original web/native headings so old anchors keep working. Remaining changes are prose only.

Disposable parent check scripts: /tmp/die-check-prose.ts compares fences, inline code, link targets and headings for a git range. /tmp/die-check-doc-links.ts compares local link/anchor errors against base 3054e14 so old broken links are not blamed on this pass. Full worker launch list is also in /tmp/die-prose-workers.json; durable paths/branches are above.

Joined docs link check: 250 local links checked, no new missing paths/anchors against base. 51 pre-existing issues remain outside this voice-only pass. Rerun after final joins.
