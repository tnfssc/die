# Experimental voice-only Live Lab

This is a test build, not a release. It has no coding-agent handoff yet.
It uses Gemini 3.8 Live and native voice-processing audio. The version number
still matches the last release; SOURCE.txt identifies this candidate commit.

Keep die and the audio helper in the same folder. Run ./die there, then enter
/live-lab. Choose Start only when you want a paid Google connection and local
microphone/speaker access. /live-lab stop closes voice, not agent work.
Use /live-lab status for queue/capture diagnostics. Transcripts stay in the
current UI only; they are not saved to chat by this feature.

Use your existing Google API-key auth. The old /live setup can import your
private ~/.die/live.env with confirmation, but its SoX checks belong to old
/live, not this native lab. Do not paste a key into chat or commands.

macOS: no SoX or Xcode is needed to run this bundle. Allow microphone access
for the terminal host when macOS asks. This helper is experimental and not
Developer-ID notarized. Report any launch/permission failure rather than
turning off system security settings.

Linux development builds need libpulse, WebRTC AudioProcessing 1.x, json-c,
and glib shared libraries and a running PulseAudio-compatible server. They
are not dependency-free distribution artifacts yet.

Check short and long replies, natural pauses, and interruption. A reply should
finish its last word unless you interrupt it. Note headphones vs speakers,
rough delay, and whether the status reports an error. Native CI and virtual
loopback tests do not prove the quality of your physical audio route.
