# Custom native models.json evidence

Offline loopback command:

`TMPDIR=$HOME/.cache/godie-config-tmp GODIE_BIN=validation/artifacts/godie-config-native python3 validation/config-native-cli.py`

Result: **PASS** for configured OpenAI Responses, Anthropic Messages, and Google Generative AI CLI requests. The fixture asserted API paths, selected model IDs, configured max-token defaults, provider headers, API-specific auth headers, and no generated credential header from either other native API.

Test logs are under `validation/artifacts/config-{cli,app-test,provider-test,race,full-race}.log`. All tests and fixtures are offline; no live credentials or internet were used.
