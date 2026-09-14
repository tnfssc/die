# Final Markdown resource recheck

Main-agent verification against **source-built bin/die-original**, not merely the Pi bundle. Candidate final combined hash:58cb0acbf54ba2e774a6b0ee0aea5f9473f002f8d965153e50eaa638644ac963.

Both actual CLIs made exactly2 loopback requests: a print-mode prompt-template expansion and a controlling-PTY skill invocation. Both rendered the fixture acknowledgement and exited0. Template messages match after trimming only the boundary newline; skill messages match after substituting only the generated absolute fixture location/reference directory. No prompt/body content was otherwise normalized.

Evidence: validation/artifacts/resources-source-combined/{resources-original.json,resources-candidate.json,comparison.json}, plus resources-source-candidate-recheck.log. The final candidate driver waits for rendered acknowledgement and asserts clean exit; its first version exited immediately after observing the HTTP request and prematurely interrupted the response, so that version’s zero harness exit was not accepted as terminal success.

Original used explicit DIE_CODING_AGENT_DIR pointing at isolated global fixtures and --no-approve to avoid authorizing project resources. Candidate used generated project/global fixtures under its isolated HOME/state. No real auth, network providers, package installation or original state mutation. Separate worker unit/race tests cover no-approve/no-context-files/resource precedence and discovery restrictions.

The earlier resource worker comparison used the original Pi CLI; it remains useful supporting evidence but is superseded for whole-app baseline purposes by this source-built Die comparison.
