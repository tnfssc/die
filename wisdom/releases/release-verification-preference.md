# Release verification preference

After v0.5.4 on 2026-09-22, the user said not to download published binaries only to check their hashes again after release CI passes. CI hashes the finished binaries, then uploads those same files. Matching that hash does not prove the binary works. For a normal release, trust passing release CI and check that the release and assets exist. Download or run them only for a real risk or when the user asks.

The user said this after the assistant downloaded the ~200 MB binary without need, timed out, and tried again. Do not repeat that work.
