import { createHash, randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;
const MAX_PENDING_LAUNCHES = 256;
const MAX_LEDGER_BYTES = 64 * 1024;
const MAX_FINGERPRINT_LENGTH = 128;
const MAX_CLIENT_REQUEST_ID_LENGTH = 128;
type Entry = { fingerprint: string; clientRequestId: string };
type FileShape = { version: 1; pending: Entry[] };
type PathSerializer = { tail: Promise<unknown>; users: number };
const activePathSerializers = new Map<string, PathSerializer>();

function validEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Entry;
  return (
    typeof entry.fingerprint === "string" &&
    entry.fingerprint.length > 0 &&
    entry.fingerprint.length <= MAX_FINGERPRINT_LENGTH &&
    typeof entry.clientRequestId === "string" &&
    entry.clientRequestId.length > 0 &&
    entry.clientRequestId.length <= MAX_CLIENT_REQUEST_ID_LENGTH
  );
}

function parse(value: string): FileShape {
  const decoded: unknown = JSON.parse(value);
  if (!decoded || typeof decoded !== "object" || (decoded as { version?: unknown }).version !== VERSION)
    throw new Error("Invalid T3 launch identity ledger");
  const pending = (decoded as { pending?: unknown }).pending;
  if (!Array.isArray(pending) || pending.length > MAX_PENDING_LAUNCHES || !pending.every(validEntry))
    throw new Error("Invalid T3 launch identity ledger");
  if (new Set(pending.map((entry) => entry.fingerprint)).size !== pending.length)
    throw new Error("Invalid T3 launch identity ledger");
  if (new Set(pending.map((entry) => entry.clientRequestId)).size !== pending.length)
    throw new Error("Invalid T3 launch identity ledger");
  return { version: VERSION, pending };
}

/** Only launch replay identity is persisted; child state and output remain T3-owned. */
export class T3LaunchIdentityLedger {
  constructor(readonly path: string) {}

  /** Exposes only resource cardinality for focused lifecycle tests. */
  static activePathCountForTesting(): number {
    return activePathSerializers.size;
  }

  static fingerprint(parts: readonly string[]): string {
    if (!parts.length || parts.some((part) => typeof part !== "string" || Buffer.byteLength(part) > 4096))
      throw new Error("Invalid T3 launch intent identity");
    const hash = createHash("sha256");
    for (const part of parts) {
      const bytes = Buffer.from(part);
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(bytes.length);
      hash.update(length).update(bytes);
    }
    return hash.digest("base64url");
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    let serializer = activePathSerializers.get(this.path);
    if (!serializer) {
      serializer = { tail: Promise.resolve(), users: 0 };
      activePathSerializers.set(this.path, serializer);
    }
    const active = serializer;
    active.users++;
    const result = active.tail.then(operation, operation);
    active.tail = result.catch(() => undefined);
    return result.finally(() => {
      active.users--;
      if (active.users === 0 && activePathSerializers.get(this.path) === active)
        activePathSerializers.delete(this.path);
    });
  }

  async #read(): Promise<FileShape> {
    let file;
    try {
      file = await open(this.path, "r");
      const stats = await file.stat();
      if (stats.size > MAX_LEDGER_BYTES) throw new Error("T3 launch identity ledger exceeds its size limit");
      return parse(await file.readFile("utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: VERSION, pending: [] };
      throw error;
    } finally {
      await file?.close().catch(() => undefined);
    }
  }

  async #write(value: FileShape): Promise<void> {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > MAX_LEDGER_BYTES)
      throw new Error("T3 launch identity ledger exceeds its size limit");
    const temporary = this.path + "." + randomUUID() + ".tmp";
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      await file.writeFile(encoded);
      await file.sync();
      await file.close();
      file = undefined;
      await rename(temporary, this.path);
      const directory = await open(dirname(this.path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await file?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  reserve(fingerprint: string): Promise<string> {
    if (!fingerprint || fingerprint.length > MAX_FINGERPRINT_LENGTH)
      return Promise.reject(new Error("Invalid T3 launch fingerprint"));
    return this.#serialized(async () => {
      const ledger = await this.#read();
      const existing = ledger.pending.find((item) => item.fingerprint === fingerprint);
      if (existing) return existing.clientRequestId;
      // The replay key is deterministic, so dropping oldest local bookkeeping
      // cannot lose recovery identity or orphan a backend-owned task.
      if (ledger.pending.length >= MAX_PENDING_LAUNCHES) ledger.pending.shift();
      // The sandbox ACK retires local delivery bookkeeping, not the durable
      // execute intent. A crash after that ACK but before the outer tool result
      // commits must still replay the same native child.
      const clientRequestId = "die-v1:" + T3LaunchIdentityLedger.fingerprint([fingerprint]);
      ledger.pending.push({ fingerprint, clientRequestId });
      await this.#write(ledger); // Must complete before any launch I/O.
      return clientRequestId;
    });
  }

  acknowledge(clientRequestId: string): Promise<void> {
    if (!clientRequestId || clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH)
      return Promise.reject(new Error("Invalid T3 launch request identity"));
    return this.#serialized(async () => {
      const ledger = await this.#read();
      const pending = ledger.pending.filter((item) => item.clientRequestId !== clientRequestId);
      if (pending.length !== ledger.pending.length) await this.#write({ version: VERSION, pending });
    });
  }
}
