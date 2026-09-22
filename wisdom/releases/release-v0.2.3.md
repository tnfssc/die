# v0.2.3

- Shell jobs now wait up to 3 seconds by default before returning in the background (previously 1 second).
- Explicit waitSeconds overrides, including zero for immediate background return, remain unchanged. Execution timeouts are independent, and subagents still default to a 1-second foreground wait.
- Updated agent guidance and documentation to match.

No dependency changes or paid provider probes.
