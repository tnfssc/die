# Live transcript snapshot handoff

The quoted inline context is capped at 24k characters; when earlier valid entries are omitted, the host writes a branch-only JSON snapshot of the received transcript, not the raw session JSONL (which may contain sibling branches). The captured leaf must still match before dispatch. A concurrent append to the same branch also changes the leaf and conservatively rejects the handoff; retry with a new request ID. Session/branch switches during async I/O cannot queue a stale snapshot.

Snapshots live in a private per-user directory under the OS temp directory, named by SHA-256 of their immutable JSON content. Identical snapshots across requests/reconnects reuse one file and renew its 24-hour read window; closing the live connection does not delete queued readers' snapshots. Expired files are reclaimed on the next snapshot creation (not by a timer). At most 64 unexpired files / 16 MiB total are retained; if a new snapshot cannot fit, handoff fails explicitly rather than silently dropping history or evicting a pending reader. A single snapshot over 16 MiB also fails. Delivery failures clean up newly created snapshots. Files remain accessible to the local agent until their window expires, unless the user/system removes the OS temp directory; callers should read promptly. Persistent session entries remain the recovery source after expiry, but reconstruct only the selected branch, never export the entire session file; ephemeral sessions have no durable recovery source. These limits are independent of the bridge's in-memory request-ID capacity.

Parent correction: snapshots are shared, so failure no longer deletes a new
content-addressed file outside its lock. Another queued reader may have reused
it meanwhile. Failed handoffs leave private content under the same 24-hour
eligibility and aggregate budget. lstat rejects symlink files/directories.
Cleanup is lazy on future snapshot creation, not a background deletion promise.
13 host tests/typecheck passed.
