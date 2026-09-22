# Release verification preference

User clarified after v0.5.4 (2026-09-22): do not download published binaries solely to recheck checksums after successful release CI. Current CI hashes finished binaries and immediately uploads the same files; a matching checksum does not validate runtime correctness. For ordinary release requests, rely on passing release CI and confirm publication/assets. Additional download/runtime validation should address a concrete risk or explicit request, not be automatic ceremony.

This preference was stated after the assistant unnecessarily downloaded the ~200MB binary, timed out, and retried. Avoid repeating that overhead.
