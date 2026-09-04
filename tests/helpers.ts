export async function run(
  command: string[],
  options: { env?: Record<string, string | undefined>; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
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
