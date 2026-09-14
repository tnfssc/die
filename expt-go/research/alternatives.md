# Existing Go agents and reuse boundaries

Research date: 2026-09-13. Web search and extraction used the requested `tvly` CLI (raw evidence in sources/architecture-*.json).

## Crush: reference, not the starting codebase

[Crush](https://github.com/charmbracelet/crush) demonstrates a Go terminal coding agent with provider selection, sessions, and integrations. It is useful for studying UX and identifying libraries, not evidence that die’s execution/job/compaction contracts are already available.

The [current license](https://github.com/charmbracelet/crush/blob/main/LICENSE.md) is **FSL-1.1-MIT**, with a competing-use restriction and a future MIT grant after two years for the applicable software. Do not assume the current app is MIT or copy/fork its code for this replacement without an applicable-license review. Independently licensed libraries must be checked separately. The first extraction tried LICENSE and got a 404; the corrected LICENSE.md extraction succeeded.

## Fantasy: evaluate as an adapter, not the session owner

[Fantasy](https://github.com/charmbracelet/fantasy) is Charm’s Go agent/provider library. Its separately extracted [license](https://github.com/charmbracelet/fantasy/blob/main/LICENSE) is Apache-2.0. It is a plausible alternative to several direct SDK wrappers. Whether it preserves every provider-native reasoning item, checkpoint, cache identity, and cancellation behavior required by die needs a conformance spike; a unified API is not proof of parity.

Keep godie’s turn lifecycle, job ownership, persistence, and compaction policy outside any framework. This makes provider-library substitution small rather than a second app rewrite.

## Broader frameworks

The initial search also found [Genkit Go skills](https://developers.googleblog.com/enable-on-demand-expertise-with-agent-skills-in-genkit-go) and [GitHub Agentic Workflows](https://githubnext.com/projects/agentic-workflows). Neither search result establishes a closer fit than a small Go core for die’s local interactive execution model. GitHub Actions orchestration is a different deployment model. No framework benchmark or compatibility experiment was run.

## Evidence limits

Search results are discovery material, not implementation guarantees. Prefer primary repository/documentation extracts over third-party promotional summaries. These URLs follow mutable main branches; pin versions and recheck licenses/APIs before adding dependencies. No third-party application code was copied.
