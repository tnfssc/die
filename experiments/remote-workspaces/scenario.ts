// Same unmodified ordinary execute source for A and B. Relative APIs must resolve
// against the target cwd; no fs proxy, path translation or special remote APIs.
export const identityCode = `
import { stat, readFile } from "node:fs/promises";
import { statSync } from "node:fs";
const s = await stat("identity.txt");
const imported = await import(process.cwd() + "/target-module.ts");
const job = await shell("printf 'shell-cwd='; pwd; sleep 1; printf 'target-ready\\n'; printf 'once\\n' >> shell-effects.txt", {waitSeconds: 0});
console.log(JSON.stringify({ cwd: process.cwd(), ino: s.ino, syncIno: statSync("identity.txt").ino,
  nodeRead: await readFile("identity.txt", "utf8"), bunRead: await Bun.file("identity.txt").text(),
  moduleIdentity: imported.identity, job }));
`;
export function finishCode(mode: "A" | "B") {
  return `import { appendFile } from "node:fs/promises"; await appendFile("controller-effects.txt", "${mode}:feedback-observed\\n"); console.log("${mode}:second-execute");`;
}
