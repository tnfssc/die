import type { AudioSetupError } from "./audio";
/** Only known protocol codes cross into UI. Helper messages and process errors are untrusted. */
export function audioDiagnostic(code: string, setup?: AudioSetupError): string {
  const detail =
    setup &&
    [
      "NSOSStatusErrorDomain",
      "AVFoundationErrorDomain",
      "NSCocoaErrorDomain",
      "NSPOSIXErrorDomain",
      "input-format",
      "output-format",
    ].includes(setup.domain) &&
    Number.isSafeInteger(setup.number) &&
    setup.number >= -2147483648 &&
    setup.number <= 2147483647
      ? ` (NSError ${setup.domain} ${setup.number})`
      : "";
  switch (code) {
    case "permission":
      return "Microphone access denied [permission]. Check System Settings → Privacy & Security → Microphone for your terminal/die, then retry. On unsigned builds macOS may attribute access differently.";
    case "input_format":
      return (
        "Default microphone format unsupported [input_format]" +
        detail +
        ". Choose another default input in System Settings → Sound and retry."
      );
    case "output_format":
      return (
        "Default speaker format unsupported [output_format]" +
        detail +
        ". Choose another default output in System Settings → Sound and retry."
      );
    case "voice_processing":
      return (
        "Voice processing could not initialize [voice_processing]" +
        detail +
        ". Check the default input/output route; try another device."
      );
    case "output_connect":
      return "Audio setup failed at output_connect [output_connect]" + detail + ".";
    case "source_attach":
      return "Audio setup failed at source_attach [source_attach]" + detail + ".";
    case "source_connect":
      return "Audio setup failed at source_connect [source_connect]" + detail + ".";
    case "tap_install":
      return "Audio setup failed at tap_install [tap_install]" + detail + ".";
    case "engine_start":
      return "Audio setup failed at engine_start [engine_start]" + detail + ".";
    case "audio_start":
      return "Default audio route could not start [audio_start]. Check microphone permission and default input/output devices, then retry.";
    case "route_lost":
      return "Audio device route changed [route_lost]. Check default devices and retry.";
    case "capture_overflow":
      return "Microphone capture could not keep up [capture_overflow]. Retry with fewer competing audio apps.";
    case "playback_full":
      return "Speaker playback queue filled [playback_full]. Retry.";
    case "helper_failure":
      return "Audio helper process failed [helper_failure]. Run die --live-self-test (no devices); if it passes, try /live mic-check (requires consent, no provider).";
    default:
      return "Audio helper failed [unclassified]. Run die --live-self-test (no devices); then /live mic-check with consent. Report the step and code, not secrets.";
  }
}
export function audioLaunchDiagnostic(): string {
  return "Audio helper could not launch or respond [launch]. Run die --live-self-test (no devices). Check local terminal and executable permissions; report which step failed.";
}
