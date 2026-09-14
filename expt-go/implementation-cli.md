# CLI/session-selection integration

Implemented in scoped files:

- `internal/app/cli_sessions.go`: path/exact/prefix session lookup (local before global), exact session IDs, native session forks, read-only HTML export, and textual `@file` prompt expansion.
- `cmd/godie/cli_parity.go`: preflight adapter for the coordinator-owned main.
- `internal/app/options.go`: localized fields/flags/help and conflict validation only.

## Required coordinator integration

Apply this exact insertion in `cmd/godie/main.go` after the `ListModels` early-return block (after current line 84), before the `Resume` listing block and before `app.NewApplication`:

```diff
@@
 	if o.ListModels {
@@
 		return nil
 	}
+	handled, err := applyCLIParity(&o)
+	if err != nil {
+		return err
+	}
+	if handled {
+		return nil
+	}
 	if o.Resume && o.Session == "" {
```

This ordering keeps help/version/login/licenses/auth/model metadata commands side-effect free, lets `--export SESSION [OUTPUT]` terminate before provider/runtime setup, and ensures resolved/forked session paths and expanded prompt files reach `NewApplication` and the existing `strings.Join(o.Messages, " ")` prompt path.

## Deliberate current boundary

Text `@file` attachments are native. Empty files are skipped and UTF-8 BOM is stripped. Binary/image CLI attachments fail explicitly because the current main submission API accepts only a string; silently degrading image bytes into prompt text would be unsafe. The existing `core.Message.Images` can support a later typed submission integration.
