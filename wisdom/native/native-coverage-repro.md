# Native coverage offline repro

- source: journal readonly parse; capture leaf id 4bfa13ef, timestamp 2026-09-14T15:17:11.204Z; preceding assistant id b21e01e1 is not included.
- SDK path entries: 752; SDK context messages: 526; role counts: {"compactionSummary":1,"assistant":225,"toolResult":206,"custom":84,"user":10}.
- prepareCompaction: firstKeptEntryId 05365d10, tokensBefore 309097, messagesToSummarize 491, split false.
- mismatch metadata: required-prep/context delta 35; compaction entry id 54709353, timestamp 2026-09-14T13:09:12.263Z, mapped role compactionSummary, length 2; it is present in available SDK context, so omission is not demonstrated.
- content/property-order comparison: unavailable by instruction; memory capture unavailable.
- artifacts: artifacts/offlinecoverage-sdk.json, artifacts/offlinecoverage-summary.json.

Superseded by main proof in native-compaction-current-incident.md: these counts alone do not establish a mismatch; actual narrowed cause was an empty failed assistant removed by SDK retry from live context.
