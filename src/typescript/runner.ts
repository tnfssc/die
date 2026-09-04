export const INTERNAL_TYPESCRIPT_RUNNER_ARG = "--die-internal-typescript-runner";

export async function runTypeScriptFromStdin(): Promise<void> {
  const source = await Bun.stdin.text();
  if (!source.trim()) throw new Error("No TypeScript source was provided");

  const transpiler = new Bun.Transpiler({
    loader: "ts",
    target: "bun",
  });
  const javascript = transpiler.transformSync(source);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  await import(moduleUrl);
}
