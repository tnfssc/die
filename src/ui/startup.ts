import { SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * Scoped presentation policy for Pi's CLI, which has no settings-injection hook.
 * A one-time applyOverrides() is insufficient: startup saves/reloads rebuild the
 * settings snapshot. Adapt the public presentation getter instead, without
 * mutating stored preferences, skill discovery, or command registration.
 * Pi still honors --verbose as an explicit diagnostic override.
 */
export function installQuietStartup(): () => void {
  const original = SettingsManager.prototype.getQuietStartup;
  const quiet = () => true;
  SettingsManager.prototype.getQuietStartup = quiet;
  return () => {
    if (SettingsManager.prototype.getQuietStartup === quiet) {
      SettingsManager.prototype.getQuietStartup = original;
    }
  };
}
