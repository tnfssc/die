# Live voice stays in the CLI

Web live voice has been removed. The web controls, audio transport, voice route, and private voice-session bridge introduced in v0.12.0 are no longer included. Normal web coding sessions remain available.

CLI live voice is unchanged. Use `/live provider`, `/live model`, and `/live start` to choose and start voice in the CLI. Live voice usage still contributes to the CLI session cost; pending or incomplete billing stays marked.

This is a corrective release. The web integration did not meet the required usability and working-product standard, and it is not being kept behind a flag.

## Update

Run `die update`, restart die and any running `die web` server, then check `die --version` reports `0.12.1`. Reload the web page to use the rebuilt UI.
