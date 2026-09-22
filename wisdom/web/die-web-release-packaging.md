# Die web release packaging

The release workflow builds the pinned T3 sidecar with Node 24 and pnpm 11.10.0, packages it as `die-web-linux-x64.tar.gz`, and publishes its SHA-256 checksum. `SOURCE.txt` records the T3 revision and integration patch checksum. The existing Linux binary asset remains unchanged.
