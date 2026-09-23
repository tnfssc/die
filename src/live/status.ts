/** One horizontal audio-reactive line, rendered by the existing CLI footer. */
export function liveStatus(level: number, connecting = false): string {
  if (connecting) return "live connecting ────────";
  const strength = Math.max(0, Math.min(4, Math.ceil((Number.isFinite(level) ? level : 0) * 4)));
  return "live " + "─".repeat(4 - strength) + "━".repeat(strength * 2) + "─".repeat(4 - strength);
}

export function liveLocalOnly(mode: string, env: Record<string, string | undefined>, tty: boolean): boolean {
  return (
    mode === "tui" &&
    tty &&
    !env.SSH_CONNECTION &&
    !env.SSH_CLIENT &&
    !env.SSH_TTY &&
    !env.DIE_WEB_DIE_BINARY &&
    !(Number(env.DIE_SUBAGENT_DEPTH) > 0)
  );
}
