export function offlineTestEnv(
  source: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...source, HERDR_ENV: "0" };
  delete env.HERDR_SOCKET_PATH;
  delete env.HERDR_PANE_ID;
  return env;
}

export async function run(
  command: string[],
  options: { env?: Record<string, string | undefined>; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: offlineTestEnv(options.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}
