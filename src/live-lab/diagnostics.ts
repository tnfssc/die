/** Only known protocol codes cross into UI. Helper messages and process errors are untrusted. */
export function audioDiagnostic(code: string): string {
  switch (code) {
    case "permission":
      return "Microphone access denied [permission]. Check System Settings → Privacy & Security → Microphone for your terminal/die, then retry. On unsigned builds macOS may attribute access differently.";
    case "input_format":
      return "Default microphone format unsupported [input_format]. Choose another default input in System Settings → Sound and retry.";
    case "output_format":
      return "Default speaker format unsupported [output_format]. Choose another default output in System Settings → Sound and retry.";
    case "voice_processing":
      return "Voice processing could not initialize [voice_processing]. Check the default input/output route; try another device.";
    case "audio_start":
      return "Default audio route could not start [audio_start]. Check microphone permission and default input/output devices, then retry.";
    case "route_lost":
      return "Audio device route changed [route_lost]. Check default devices and retry.";
    case "capture_overflow":
      return "Microphone capture could not keep up [capture_overflow]. Retry with fewer competing audio apps.";
    case "playback_full":
      return "Speaker playback queue filled [playback_full]. Retry.";
    case "helper_failure":
      return "Audio helper process failed [helper_failure]. Run die --live-lab-self-test (no devices); if it passes, try /live-lab mic-check (requires consent, no provider).";
    default:
      return "Audio helper failed [unclassified]. Run die --live-lab-self-test (no devices); then /live-lab mic-check with consent. Report the step and code, not secrets.";
  }
}
export function audioLaunchDiagnostic(): string {
  return "Audio helper could not launch or respond [launch]. Run die --live-lab-self-test (no devices). Check local terminal and executable permissions; report which step failed.";
}
