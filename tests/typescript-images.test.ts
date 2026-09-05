import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { executeIsolated, formatResult } from "../src/typescript/execution";
import { decodeImageChannel, imageMimeType, MAX_IMAGE_BYTES, MAX_IMAGE_CHANNEL_BYTES } from "../src/typescript/images";
import { makePng } from "./image-fixture";

const binary = resolve(import.meta.dir, "../dist/die");
let directory: string;
const png = makePng();
const encoded = png.toString("base64");
const bytesCode = `Buffer.from(${JSON.stringify(encoded)}, "base64")`;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "die-images-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
function execute(code: string, timeoutMs = 3_000) {
  return executeIsolated(code, directory, undefined, timeoutMs, { executablePath: binary, killGraceMs: 100 });
}
function record(data = encoded, mimeType = "image/png") {
  return Buffer.from(JSON.stringify({ type: "image", data, mimeType }) + "\n");
}

describe("execute image output", () => {
  test("returns a local image without treating logs as image records or writing temporary files", async () => {
    await Bun.write(join(directory, "picture.not-png-extension"), png);
    const result = await execute(
      `console.log('ordinary output'); console.error('diagnostic'); await emitImage('picture.not-png-extension');`,
    );
    expect(result.exitCode).toBe(0);
    expect(result.imageError).toBeUndefined();
    expect(result.images).toEqual([{ type: "image", data: encoded, mimeType: "image/png" }]);
    expect(result.stdout).toBe("ordinary output\n");
    expect(result.stderr).toBe("diagnostic\n");
    expect(formatResult(result)).toContain("Returned 1 image.");
    expect(formatResult(result)).not.toContain(encoded);
    expect(await readdir(directory)).toEqual(["picture.not-png-extension"]);
    const logsOnly = await execute(`console.log(${JSON.stringify(record().toString())})`);
    expect(logsOnly.images).toEqual([]);
  });

  test("supports sliced bytes, ArrayBuffer, Blob, and Bun.file with ordered concurrent emissions", async () => {
    const variants = [
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ].map((rgb) => makePng(2, 2, () => rgb));
    await Bun.write(join(directory, "image.png"), variants[2]);
    const result = await execute(`
      const bytes = ${bytesCode};
      const padded = Buffer.concat([Buffer.from('prefix'), bytes, Buffer.from('suffix')]);
      await Promise.all([
        emitImage(padded.subarray(6, 6 + bytes.length)),
        emitImage(new Uint8Array(Buffer.from(${JSON.stringify(variants[0].toString("base64"))}, 'base64')).buffer),
        emitImage(new Blob([Buffer.from(${JSON.stringify(variants[1].toString("base64"))}, 'base64')], { type: 'text/plain' })),
        emitImage(Bun.file('image.png')),
      ]);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.images.map((image) => image.data)).toEqual([
      encoded,
      ...variants.map((image) => image.toString("base64")),
    ]);
    expect(result.imageError).toBeUndefined();
  });

  test("rejects empty, unsupported, missing, oversized, and excess-count images", async () => {
    for (const code of [
      `await emitImage(new Uint8Array())`,
      `await emitImage(new Blob(['<svg></svg>']))`,
      `await emitImage('missing.png')`,
      `await emitImage(new Uint8Array(${MAX_IMAGE_BYTES + 1}))`,
      `for (let i = 0; i < 5; i++) await emitImage(${bytesCode})`,
    ]) {
      const result = await execute(code);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.length).toBeGreaterThan(0);
      expect(result.images).toEqual([]);
    }
  });

  test("enforces total bytes and transports images larger than pipe capacity", async () => {
    // PNG permits ancillary chunks; trailing padding here exercises transport
    // limits independently of image decoding (the helper checks headers only).
    const result = await execute(`
      const large = Buffer.concat([${bytesCode}, Buffer.alloc(3_400_000)]);
      await emitImage(large); await emitImage(large);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.imageError).toBeUndefined();
    expect(result.images).toHaveLength(2);
    const overflow = await execute(`
      const large = Buffer.concat([${bytesCode}, Buffer.alloc(3_400_000)]);
      await emitImage(large); await emitImage(large); await emitImage(large);
    `);
    expect(overflow.exitCode).toBe(1);
    expect(overflow.stderr).toContain("total exceeds");
    expect(overflow.images).toEqual([]);
  });

  test("allows catching invalid input before emitting a valid image", async () => {
    const result = await execute(`try { await emitImage(new Blob(['bad'])); } catch {} await emitImage(${bytesCode});`);
    expect(result.exitCode).toBe(0);
    expect(result.images).toHaveLength(1);
  });

  test("discards images on failure or timeout", async () => {
    const failed = await execute(`await emitImage(${bytesCode}); throw new Error('after-image');`);
    expect(failed.exitCode).toBe(1);
    expect(failed.images).toEqual([]);
    const timed = await execute(
      `await emitImage(${bytesCode}); setInterval(() => {}, 1000); await new Promise(() => {});`,
      500,
    );
    expect(timed.timedOut).toBe(true);
    expect(timed.images).toEqual([]);
  });

  test("rejects malformed private output and kills channel floods", async () => {
    const partial = await execute(`require('node:fs').writeSync(3, '{"type":"image"');`);
    expect(partial.imageError).toContain("Incomplete");
    expect(partial.images).toEqual([]);
    expect(formatResult(partial)).toContain("Execution failed");
    const flood = await execute(`
      const stream = require('node:fs').createWriteStream('', { fd: 3, autoClose: false });
      await new Promise((resolve, reject) => stream.write(Buffer.alloc(${MAX_IMAGE_CHANNEL_BYTES + 100_000}, 120), error => error ? reject(error) : resolve()));
      setInterval(() => {}, 1000); await new Promise(() => {});
    `);
    expect(flood.imageError).toContain("byte limit");
    expect(flood.timedOut).toBe(false);
    expect(flood.images).toEqual([]);
  });

  test("does not use a private descriptor when invoked outside execute", async () => {
    const child = Bun.spawn([binary, "--die-internal-execute"], {
      cwd: directory,
      env: { ...process.env, DIE_EXECUTE_IMAGE_CHANNEL: undefined },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    child.stdin.write(`await emitImage(${bytesCode});`);
    child.stdin.end();
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain("available only through the execute tool");
  });

  test("validates format headers and untrusted frame metadata", () => {
    expect(imageMimeType(png)).toBe("image/png");
    expect(imageMimeType(Buffer.from("ffd8ffe00010", "hex"))).toBe("image/jpeg");
    expect(imageMimeType(Buffer.from("GIF89a" + "\0".repeat(7)))).toBe("image/gif");
    expect(imageMimeType(Buffer.from("RIFF" + "\0".repeat(4) + "WEBPVP8 " + "\0".repeat(4)))).toBe("image/webp");
    expect(() => imageMimeType(Buffer.from("not an image"))).toThrow();
    expect(() => decodeImageChannel(record(encoded, "image/jpeg"))).toThrow("mismatch");
    expect(() => decodeImageChannel(record("%%%"))).toThrow("base64");
    expect(() => decodeImageChannel(Buffer.from("null\n"))).toThrow("Invalid");
    expect(() => decodeImageChannel(Buffer.from("{bad json}\n"))).toThrow("Invalid JSON");
    expect(() => decodeImageChannel(Buffer.concat(Array(5).fill(record())))).toThrow("4 images");
  });
});
