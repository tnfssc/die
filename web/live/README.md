# Browser Live foundation — not shipped

No UI button, route, host bridge, device adapters or credential exchange is shipped. See [port decision and remaining work](../../wisdom/live/web-port.md).

Inject capture (16kHz mono PCM16LE), transport and output (24kHz mono PCM16LE). Transport emits ready only after provider readiness, audio as binary PCM, interrupted to clear playback **without pausing input**, and closed/error. send16k is binary; sendControl carries mute/end. No long-lived provider credentials may enter this interface.

Adapters must copy retained frames, bound their own queues and make stop/close idempotent. queuedBytes means current backlog, not lifetime totals. Controller limits input frames to 100ms/3200 bytes, unsent input to 200ms/6400 bytes, output frames to 200ms/9600 bytes, playout backlog to 250ms/12000 bytes. Exceeding a bound is a visible error, not silent dropping. Device adapters must stop all media tracks and audio nodes/context. Transport connect must honor AbortSignal and close sockets even during handshake. getUserMedia cannot be cancelled; a late result is immediately stopped. The connecting/provider-ready deadline is 15 seconds; permission prompts remain browser-owned.

start() is explicit and resolves after setup, not provider readiness. Subscribe only to coarse lifecycle states: never per-audio-frame React state or idle animation loops. End/dispose invalidate pending acquisition/connection and release voice resources only; mute suppresses forwarding and informs the server. The future UI must show permission/connecting/ready/muted/error truthfully, use deliberate retry rather than automatic microphone reacquisition, and call dispose on unmount or owning-thread switch.
