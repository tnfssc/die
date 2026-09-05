import { createWriteStream } from "node:fs";
import type { ImageContent } from "@earendil-works/pi-ai";

export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_TOTAL_IMAGE_BYTES = 10_000_000;
export const MAX_IMAGES = 4;
export const IMAGE_CHANNEL_ENV = "DIE_EXECUTE_IMAGE_CHANNEL";
// Base64 expansion plus JSON framing; cap the entire private pipe, not stdout.
export const MAX_IMAGE_CHANNEL_BYTES = Math.ceil(MAX_TOTAL_IMAGE_BYTES / 3) * 4 + 4_096;

export type ImageInput = string | Uint8Array | ArrayBuffer | Blob;

export function imageMimeType(bytes: Uint8Array): string {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 33 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString("ascii", 12, 16) === "IHDR") return "image/png";
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 13 && ["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6))) return "image/gif";
  if (b.length >= 20 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("emitImage supports PNG, JPEG, GIF, and WebP bytes; unsupported or missing image header");
}

function checkSize(size: number): void {
  if (size > MAX_IMAGE_BYTES) throw new Error(`emitImage image exceeds ${MAX_IMAGE_BYTES} bytes; resize or compress it first`);
  if (size === 0) throw new Error("emitImage cannot return an empty image");
}

async function imageBytes(input: ImageInput): Promise<Buffer> {
  if (typeof input === "string" || input instanceof Blob) {
    if (typeof input === "string" && !(await Bun.file(input).exists())) throw new Error(`Image file not found: ${input}`);
    const blob = typeof input === "string" ? Bun.file(input) : input;
    checkSize(blob.size);
    // Bound reads even if a file grows after its size was checked.
    const bytes = Buffer.from(await blob.slice(0, MAX_IMAGE_BYTES + 1).arrayBuffer());
    checkSize(bytes.length);
    return bytes;
  }
  if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    checkSize(input.byteLength);
    return input instanceof ArrayBuffer ? Buffer.from(new Uint8Array(input)) : Buffer.from(input);
  }
  throw new Error("emitImage expects a file path, Uint8Array/Buffer, ArrayBuffer, or Blob");
}

/** Child-side helper. Serialize calls so concurrent emissions preserve call order. */
export function createImageEmitter(channelEnabled: boolean) {
  let queue = Promise.resolve();
  let count = 0;
  let total = 0;
  let stream: ReturnType<typeof createWriteStream> | undefined;
  return {
    emitImage(input: ImageInput): Promise<void> {
      const operation = queue.then(async () => {
        if (!channelEnabled) throw new Error("emitImage is available only through the execute tool");
        if (count >= MAX_IMAGES) throw new Error(`emitImage allows at most ${MAX_IMAGES} images per execution`);
        const bytes = await imageBytes(input);
        const mimeType = imageMimeType(bytes);
        if (total + bytes.length > MAX_TOTAL_IMAGE_BYTES) throw new Error(`emitImage total exceeds ${MAX_TOTAL_IMAGE_BYTES} bytes`);
        stream ??= createWriteStream("", { fd: 3, autoClose: false });
        // The write callback reports pipe errors; don't also emit an unhandled
        // error event if the parent has cancelled the execution.
        if (stream.listenerCount("error") === 0) stream.on("error", () => {});
        const record: ImageContent = { type: "image", mimeType, data: bytes.toString("base64") };
        await new Promise<void>((resolve, reject) => {
          stream!.write(`${JSON.stringify(record)}\n`, (error) => error ? reject(error) : resolve());
        });
        count++;
        total += bytes.length;
      });
      // A caught invalid emission must not prevent later valid emissions.
      queue = operation.catch(() => {});
      return operation;
    },
    async finish(): Promise<void> {
      await queue;
      if (stream) await new Promise<void>((resolve) => stream!.end(resolve));
    },
  };
}

/** Parent-side validation: the helper is convenient, not a trust boundary. */
export function decodeImageChannel(buffer: Buffer): ImageContent[] {
  if (buffer.length > MAX_IMAGE_CHANNEL_BYTES) throw new Error("Image output channel exceeded its byte limit");
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 10) throw new Error("Incomplete image output record");
  const records = buffer.toString("utf8").slice(0, -1).split("\n");
  if (records.length > MAX_IMAGES) throw new Error(`Image output exceeds ${MAX_IMAGES} images`);
  let total = 0;
  return records.map((record) => {
    let value: Partial<ImageContent> | null;
    try { value = JSON.parse(record); }
    catch { throw new Error("Invalid JSON in image output record"); }
    if (!value || value.type !== "image" || typeof value.data !== "string" || typeof value.mimeType !== "string") throw new Error("Invalid image output record");
    // Validate canonical base64; Buffer.from alone silently accepts bad input.
    if (value.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error("Image output exceeds the per-image byte limit");
    if (/[^A-Za-z0-9+/=]/.test(value.data)) throw new Error("Invalid image base64");
    const bytes = Buffer.from(value.data, "base64");
    checkSize(bytes.length);
    if (bytes.toString("base64") !== value.data || imageMimeType(bytes) !== value.mimeType) throw new Error("Image output MIME type or encoding mismatch");
    total += bytes.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error("Image output exceeded its total byte limit");
    return { type: "image", mimeType: value.mimeType, data: value.data };
  });
}
