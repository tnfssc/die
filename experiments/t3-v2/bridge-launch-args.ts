import { resolve } from "node:path";

/** Preserve upstream injection and append our activation once, for split/equal flag forms. */
export function activateBridgeArgs(incoming: string[], activation: string): string[] {
  const active = incoming.some((arg, index) => {
    const value = arg === "--extension" || arg === "-e" ? incoming[index + 1]
      : arg.startsWith("--extension=") ? arg.slice("--extension=".length)
      : arg.startsWith("-e=") ? arg.slice(3) : undefined;
    return value !== undefined && resolve(value) === resolve(activation);
  });
  return active ? incoming : [...incoming, "--extension", activation];
}
