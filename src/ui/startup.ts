import { SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * Keep Pi CLI presentation policy here because Pi has no settings injection
 * hook. One applyOverrides() call is not enough: startup saves and reloads rebuild
 * the settings snapshot. Wrap the public presentation getter instead. Do not
 * change saved preferences, skill discovery, or command registration. Pi still
 * honors --verbose as an explicit diagnostic override.
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
