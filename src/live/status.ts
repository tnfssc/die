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
