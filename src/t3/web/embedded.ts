import archivePath from "../../../dist/die-web.archive.gz" with { type: "file" };
import { join } from "node:path";
import { extractWebArchive } from "./archive";

export async function embeddedWebRoot(cacheDirectory: string): Promise<string> {
  return extractWebArchive(await Bun.file(archivePath).bytes(), join(cacheDirectory, "web-runtime"));
}
