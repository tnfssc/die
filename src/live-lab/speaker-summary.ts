import type { AudioDiagnostics } from "./audio";
import type { SpeakerCheckResult } from "./speaker-check";

/** Static labels and numeric fields only: never PCM, device names, or helper errors. */
export function speakerCheckSummary(result: SpeakerCheckResult): string {
  const actions: Record<SpeakerCheckResult["status"], string> = {
    correlated_return:
      "Render-correlated residual detected. Repeat quietly at the same route/volume; compare headphones. Repeated speaker-only residual supports investigating the Apple capture graph or a separate WebRTC APM prototype, not a VAD/gating fix.",
    no_correlated_return:
      "No strong correlated return detected. This probe does not rule out speech echo or provider false interruption. Keep this result with /live-lab status from the affected voice session.",
    no_signal:
      "No usable captured signal. Confirm you heard the sound and selected the intended microphone/output; silence can mean effective suppression, muted input, or a disconnected route. Do not treat it as an AEC pass.",
    clipping:
      "Capture clipped. Lower output volume, remove nearby noise, and repeat quietly; this result cannot assess residual reliably.",
    inconclusive: "Inconclusive. Confirm route/permission, stay quiet, and repeat; do not infer cancellation quality.",
  };
  const number = (value: number | undefined, unit: string) =>
    value !== undefined && Number.isFinite(value) ? value + unit : "unknown";
  const native: AudioDiagnostics["ready"] = result.processing;
  const processing = native
    ? "voiceProcessing=" +
      native.voiceProcessingEnabled +
      ", bypass=" +
      native.voiceProcessingBypassed +
      "; capture=" +
      number(native.captureRate, "Hz") +
      "/" +
      number(native.captureChannels, "ch") +
      ", render=" +
      number(native.renderRate, "Hz") +
      "/" +
      number(native.renderChannels, "ch")
    : "native processing=unknown";
  return [
    actions[result.status] ?? actions.inconclusive,
    result.reason
      ? ({
          insufficient_capture: "Too few capture frames.",
          low_reference: "Test reference too quiet.",
          high_background: "Baseline too loud.",
          capture_overflow: "Capture exceeded bounded window.",
          playback_pending: "Playback queue did not drain.",
        }[result.reason] ?? "Measurement unavailable.")
      : "",
    "Reference correlation=" +
      number(result.correlation, "") +
      "; lag=" +
      number(result.lagMs, "ms") +
      "; linear correlated estimate=" +
      number(result.correlatedDbfs, "dBFS") +
      "; capture RMS baseline/play/tail=" +
      number(result.baselineDbfs, "dBFS") +
      "/" +
      number(result.playbackDbfs, "dBFS") +
      "/" +
      number(result.tailDbfs, "dBFS") +
      ".",
    processing + ".",
    "Reference is submitted test PCM, not a measured hardware render tap; acoustic level and actual device latency are unknown.",
  ].join(" ");
}
