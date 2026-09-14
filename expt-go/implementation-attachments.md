# CLI image attachments integration

No `cmd/godie/main.go` change is needed. The existing `applyCLIParity` call runs `app.PrepareCLIOptions` before `app.NewApplication`; prepared `Options.Images` now reaches `Engine.InitialImages` in `NewApplication`. The existing plain-string `Application.Submit` call remains unchanged.

Initial images are attached under the Engine turn lock to the first non-hidden, non-empty user prompt and then cleared. Hidden/background prompts do not consume them, and subsequent user prompts do not receive them.
