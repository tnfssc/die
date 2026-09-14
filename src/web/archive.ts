import { chmod, lstat, mkdir, readFile, readlink, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MAGIC = "DIEWEB1\n";

type ArchiveEntry =
  | { path: string; type: "directory"; mode: number }
  | { path: string; type: "file"; mode: number; size: number }
  | { path: string; type: "symlink"; target: string };

function safePath(path: string): boolean {
  return (
    path.length > 0 && !isAbsolute(path) && !path.split("/").some((part) => !part || part === "." || part === "..")
  );
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(".." + sep) && child !== ".." && !isAbsolute(child));
}

/** Build-only helper for the deterministic embedded web payload. */
export async function packWebArchive(
  source: string,
  output: string,
  options: { exclude?: readonly string[] } = {},
): Promise<string> {
  const entries: ArchiveEntry[] = [];
  const contents: Uint8Array[] = [];
  async function visit(directory: string, prefix = ""): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const path = prefix ? prefix + "/" + name : name;
      if (options.exclude?.includes(path)) continue;
      const absolute = resolve(directory, name);
      const stat = await lstat(absolute);
      if (stat.isDirectory()) {
        entries.push({ path, type: "directory", mode: 0o700 });
        await visit(absolute, path);
      } else if (stat.isSymbolicLink()) {
        entries.push({ path, type: "symlink", target: await readlink(absolute) });
      } else if (stat.isFile()) {
        const content = await readFile(absolute);
        entries.push({ path, type: "file", mode: stat.mode & 0o111 ? 0o700 : 0o600, size: content.byteLength });
        contents.push(content);
      } else throw new Error("Unsupported web payload entry: " + absolute);
    }
  }
  await visit(resolve(source));
  const manifest = Buffer.from(JSON.stringify(entries));
  const header = Buffer.alloc(MAGIC.length + 4);
  header.write(MAGIC, 0, "ascii");
  header.writeUInt32LE(manifest.byteLength, MAGIC.length);
  const packed = Buffer.concat([header, manifest, ...contents]);
  const compressed = Bun.gzipSync(packed, { level: 9 });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, compressed, { mode: 0o600 });
  return new Bun.CryptoHasher("sha256").update(compressed).digest("hex");
}

export async function extractWebArchive(archive: Uint8Array, cacheDirectory: string): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256").update(Buffer.from(archive)).digest("hex");
  const cache = resolve(cacheDirectory);
  const target = resolve(cache, hash);
  const marker = resolve(target, ".complete");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  await chmod(cache, 0o700);
  try {
    const existing = await lstat(target);
    if (!existing.isDirectory()) throw new Error("Web runtime cache target is not a directory: " + target);
    await chmod(target, 0o700);
    if ((await readFile(marker, "utf8")) === hash + "\n") return target;
    throw new Error("Existing web runtime extraction is incomplete: " + target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = resolve(cache, "." + hash + "." + process.pid + "." + crypto.randomUUID() + ".tmp");
  await mkdir(temporary, { mode: 0o700 });
  try {
    const packed = Bun.gunzipSync(Buffer.from(archive));
    const bytes = Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
    if (bytes.subarray(0, MAGIC.length).toString("ascii") !== MAGIC) throw new Error("Invalid embedded web archive");
    const manifestLength = bytes.readUInt32LE(MAGIC.length);
    const contentStart = MAGIC.length + 4 + manifestLength;
    if (contentStart > bytes.byteLength) throw new Error("Truncated embedded web archive manifest");
    const entries = JSON.parse(bytes.subarray(MAGIC.length + 4, contentStart).toString("utf8")) as ArchiveEntry[];
    let offset = contentStart;
    for (const entry of entries) {
      if (!safePath(entry.path)) throw new Error("Unsafe embedded web archive path: " + entry.path);
      const destination = resolve(temporary, ...entry.path.split("/"));
      if (!inside(temporary, destination)) throw new Error("Unsafe embedded web archive path: " + entry.path);
      if (entry.type === "directory") {
        await mkdir(destination, { recursive: true, mode: 0o700 });
      } else if (entry.type === "file") {
        if (!Number.isSafeInteger(entry.size) || entry.size < 0 || offset + entry.size > bytes.byteLength)
          throw new Error("Truncated embedded web archive file: " + entry.path);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await writeFile(destination, bytes.subarray(offset, offset + entry.size), { mode: entry.mode });
        offset += entry.size;
      } else if (entry.type === "symlink") {
        if (isAbsolute(entry.target) || !inside(temporary, resolve(dirname(destination), entry.target)))
          throw new Error("Unsafe embedded web archive symlink: " + entry.path);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await symlink(entry.target, destination);
      } else throw new Error("Unknown embedded web archive entry");
    }
    if (offset !== bytes.byteLength) throw new Error("Embedded web archive has trailing content");
    await writeFile(resolve(temporary, ".complete"), hash + "\n", { mode: 0o600 });
    try {
      await rename(temporary, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
      await rm(temporary, { recursive: true, force: true });
      if (!(await Bun.file(marker).exists()))
        throw new Error("Existing web runtime extraction is incomplete: " + target);
    }
    return target;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
