# v0.15.1

- Show GPT-Live delegated speech as a clean user turn, without internal snapshot JSON or clarification boilerplate.
- Send the coding agent only newly handled speech with a short provisional-transcription label, while keeping prior conversation in normal history.
- Keep transport metadata internal and clean old delegation snapshots when preparing model context on replay. Original saved history is not rewritten.

Verified actual serialized coding-model messages and terminal rendering with offline provider/audio fixtures. Full local tests passed. Connected provider, microphone, speaker, and speech-recognition quality remain unverified.
