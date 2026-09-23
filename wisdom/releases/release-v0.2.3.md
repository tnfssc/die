# v0.2.3

- Shell jobs now wait up to 3 seconds by default before returning in the background (previously 1 second).
- Explicit waitSeconds values still work the same, including zero for an immediate background return. Execution timeouts are separate. Subagents still wait 1 second in the foreground by default.
- Update agent guidance and docs to match.

No dependency changes or paid provider probes.
