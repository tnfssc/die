// The parent self-execs its embedded Bun runtime only for this script.
// Never let interpreter mode leak into Die CLI/RPC or terminal children.
delete process.env.BUN_BE_BUN;

const { runCli } = await import("./dist/bin.mjs");
process.exit(await runCli(process.argv.slice(2)));
