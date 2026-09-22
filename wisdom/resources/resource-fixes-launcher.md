# POSIX web launcher ownership fix

## Implemented

- `src/web/launcher.ts` now starts every POSIX external backend (including the normal embedded bootstrap path) detached as the leader of a newly owned process group.
- SIGINT/SIGTERM are forwarded only to the captured owned group ID. The launcher never targets its own PID/group; Windows retains the prior direct-child fallback without claiming process-tree cleanup.
- The first forwarded signal determines CLI status (130 for INT, 143 for TERM), including when the backend traps the signal and exits 0.
- Forwarded termination has a bounded 5 second grace and then group SIGKILL escalation.
- Backend leader exit always triggers a final SIGKILL of the owned group so descendants cannot outlive an early/graceful leader exit.
- Completion cleanup is idempotent and removes both process listeners and the escalation timer once.
- Independent signal exits now use the conventional 128 + signal number rather than treating every non-INT signal as TERM.

## Regression coverage

Added `tests/web-launcher-process.test.ts`:

1. A stubborn backend and stubborn grandchild are PID-tracked exactly. TERM to the launcher escalates, both owned processes disappear, the launcher reports 143, and the live test/die host remains alive.
2. A backend that traps INT and exits 0 while its grandchild ignores INT verifies final group cleanup and status 130.
3. 100 repeated clean backend exits preserve the subprocess's SIGINT/SIGTERM listener counts and Linux FD count exactly.

## Validation

- `bunx tsc --noEmit` passed immediately after the launcher/test implementation.
- Built a focused compiled CLI with existing web assets: `bun scripts/build.ts --reuse-web --outfile=/tmp/die-launcher-test`.
- `DIE_WEB_BINARY=/tmp/die-launcher-test bun test tests/web-launcher.test.ts tests/web-launcher-process.test.ts`: **16 pass, 0 fail**.
- Biome check on the changed launcher and new test has no errors (only pre-existing style suggestions in the launcher).
- Later rebuild and typecheck attempts were blocked by concurrent repository work: `src/cli.ts` imports a currently absent `./history/session-manager`. The already-built focused binary includes this launcher fix and was used for the final test run.

No commit or tag was created.
