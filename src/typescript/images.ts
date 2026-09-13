import fs, { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ImageContent } from "@earendil-works/pi-ai";
import photonWasm from "../../runtime-assets/photon_rs_bg.wasm" with { type: "file" };

export const MAX_IMAGE_BYTES = 5_000_000;
// Oversized images may be resized, but input reads remain bounded.
export const MAX_IMAGE_INPUT_BYTES = 25_000_000;
export const MAX_TOTAL_IMAGE_BYTES = 10_000_000;
export const MAX_IMAGES = 4;
export const IMAGE_CHANNEL_ENV = "DIE_EXECUTE_IMAGE_CHANNEL";
// Base64 expansion plus JSON framing; cap the entire private pipe, not stdout.
export const MAX_IMAGE_CHANNEL_BYTES = Math.ceil(MAX_TOTAL_IMAGE_BYTES / 3) * 4 + 4_096;

export type ImageInput = string | Uint8Array | ArrayBuffer | Blob;

export interface ImageResizeMetadata {
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
}

export type ChannelImageContent = ImageContent & { resize?: ImageResizeMetadata };

export function imageMimeType(bytes: Uint8Array): string {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    b.length >= 33 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.toString("ascii", 12, 16) === "IHDR"
  )
    return "image/png";
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 20 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  throw new Error("showImage supports PNG, JPEG, and WebP bytes; unsupported or missing image header");
}

function checkOutputSize(size: number): void {
  if (size > MAX_IMAGE_BYTES) throw new Error(`showImage image exceeds ${MAX_IMAGE_BYTES} bytes after resizing`);
  if (size === 0) throw new Error("showImage cannot return an empty image");
}

function checkInputSize(size: number): void {
  if (size > MAX_IMAGE_INPUT_BYTES) throw new Error(`showImage input exceeds ${MAX_IMAGE_INPUT_BYTES} bytes`);
  if (size === 0) throw new Error("showImage cannot return an empty image");
}

async function imageBytes(input: ImageInput): Promise<Buffer> {
  if (typeof input === "string" || input instanceof Blob) {
    if (typeof input === "string" && !(await Bun.file(input).exists()))
      throw new Error(`Image file not found: ${input}`);
    const blob = typeof input === "string" ? Bun.file(input) : input;
    checkInputSize(blob.size);
    // Bound reads even if a file grows after its size was checked.
    const bytes = Buffer.from(await blob.slice(0, MAX_IMAGE_INPUT_BYTES + 1).arrayBuffer());
    checkInputSize(bytes.length);
    return bytes;
  }
  if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    checkInputSize(input.byteLength);
    return input instanceof ArrayBuffer ? Buffer.from(new Uint8Array(input)) : Buffer.from(input);
  }
  throw new Error("showImage expects a file path, Uint8Array/Buffer, ArrayBuffer, or Blob");
}

async function withEmbeddedPhotonWasm<T>(operation: () => Promise<T>): Promise<T> {
  const originalReadFileSync = fs.readFileSync;
  const patchedReadFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    try {
      return Reflect.apply(originalReadFileSync, fs, args);
    } catch (error) {
      const path = args[0] instanceof URL ? fileURLToPath(args[0]) : String(args[0]);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !path.endsWith("photon_rs_bg.wasm")) throw error;
      return Reflect.apply(originalReadFileSync, fs, [photonWasm, ...args.slice(1)]);
    }
  }) as typeof fs.readFileSync;
  fs.readFileSync = patchedReadFileSync;
  try {
    return await operation();
  } finally {
    // Pi temporarily wraps the same method and restores our bridge first.
    fs.readFileSync = originalReadFileSync;
  }
}

async function resizeOversizedImage(
  bytes: Buffer,
  mimeType: string,
): Promise<{ bytes: Buffer; mimeType: string; resize: ImageResizeMetadata }> {
  // Use Pi's public export lazily: acceptable images should not load the coding
  // agent (or invoke its codec), while Bun can still bundle its Photon fallback.
  const { resizeImage } = await import("@earendil-works/pi-coding-agent");
  const result = await withEmbeddedPhotonWasm(() =>
    resizeImage(bytes, mimeType, {
      // Pi's maxBytes is the encoded base64 size, not the decoded byte length.
      maxBytes: Math.ceil(MAX_IMAGE_BYTES / 3) * 4,
    }),
  );
  if (!result) throw new Error(`showImage could not resize image below ${MAX_IMAGE_BYTES} bytes`);

  const resizedBytes = Buffer.from(result.data, "base64");
  checkOutputSize(resizedBytes.length);
  const detectedMimeType = imageMimeType(resizedBytes);
  if (detectedMimeType !== result.mimeType)
    throw new Error("showImage resized image MIME type did not match its bytes");
  if (!result.wasResized)
    throw new Error(`showImage resizer did not reduce oversized image below ${MAX_IMAGE_BYTES} bytes`);
  return {
    bytes: resizedBytes,
    mimeType: detectedMimeType,
    resize: {
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
      width: result.width,
      height: result.height,
    },
  };
}

/** Child-side helper. Serialize calls so concurrent emissions preserve call order. */
export function createImageHelper(channelEnabled: boolean) {
  let queue = Promise.resolve();
  let count = 0;
  let total = 0;
  let stream: ReturnType<typeof createWriteStream> | undefined;
  return {
    showImage(input: ImageInput): Promise<void> {
      const operation = queue.then(async () => {
        if (!channelEnabled) throw new Error("showImage is available only through the execute tool");
        if (count >= MAX_IMAGES) throw new Error(`showImage allows at most ${MAX_IMAGES} images per execution`);
        let bytes = await imageBytes(input);
        let mimeType = imageMimeType(bytes);
        let resize: ImageResizeMetadata | undefined;
        if (bytes.length > MAX_IMAGE_BYTES) ({ bytes, mimeType, resize } = await resizeOversizedImage(bytes, mimeType));
        checkOutputSize(bytes.length);
        if (total + bytes.length > MAX_TOTAL_IMAGE_BYTES)
          throw new Error(`showImage total exceeds ${MAX_TOTAL_IMAGE_BYTES} bytes`);
        stream ??= createWriteStream("", { fd: 3, autoClose: false });
        // The write callback reports pipe errors; don't also emit an unhandled
        // error event if the parent has cancelled the execution.
        if (stream.listenerCount("error") === 0) stream.on("error", () => {});
        const record: ChannelImageContent = {
          type: "image",
          mimeType,
          data: bytes.toString("base64"),
          ...(resize ? { resize } : {}),
        };
        await new Promise<void>((resolve, reject) => {
          stream!.write(`${JSON.stringify(record)}\n`, (error) => (error ? reject(error) : resolve()));
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

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Parent-side validation: the helper is convenient, not a trust boundary. */
export function decodeImageChannel(buffer: Buffer): ChannelImageContent[] {
  if (buffer.length > MAX_IMAGE_CHANNEL_BYTES) throw new Error("Image output channel exceeded its byte limit");
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 10) throw new Error("Incomplete image output record");
  const records = buffer.toString("utf8").slice(0, -1).split("\n");
  if (records.length > MAX_IMAGES) throw new Error(`Image output exceeds ${MAX_IMAGES} images`);
  let total = 0;
  return records.map((record) => {
    let value: (Partial<ImageContent> & { resize?: unknown }) | null;
    try {
      value = JSON.parse(record);
    } catch {
      throw new Error("Invalid JSON in image output record");
    }
    if (!value || value.type !== "image" || typeof value.data !== "string" || typeof value.mimeType !== "string")
      throw new Error("Invalid image output record");
    // Validate canonical base64; Buffer.from alone silently accepts bad input.
    if (value.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
      throw new Error("Image output exceeds the per-image byte limit");
    if (/[^A-Za-z0-9+/=]/.test(value.data)) throw new Error("Invalid image base64");
    const bytes = Buffer.from(value.data, "base64");
    checkOutputSize(bytes.length);
    if (bytes.toString("base64") !== value.data || imageMimeType(bytes) !== value.mimeType)
      throw new Error("Image output MIME type or encoding mismatch");
    let resize: ImageResizeMetadata | undefined;
    if ("resize" in value) {
      const candidate = value.resize as Partial<ImageResizeMetadata> | null;
      if (
        !candidate ||
        !isPositiveSafeInteger(candidate.originalWidth) ||
        !isPositiveSafeInteger(candidate.originalHeight) ||
        !isPositiveSafeInteger(candidate.width) ||
        !isPositiveSafeInteger(candidate.height) ||
        candidate.width > candidate.originalWidth ||
        candidate.height > candidate.originalHeight
      )
        throw new Error("Invalid image resize metadata");
      resize = candidate as ImageResizeMetadata;
    }
    total += bytes.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error("Image output exceeded its total byte limit");
    return { type: "image", mimeType: value.mimeType, data: value.data, ...(resize ? { resize } : {}) };
  });
}
