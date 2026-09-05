# Image results from `execute`

`execute` can return model-visible image attachments as well as stdout/stderr. The tool set remains `execute`, `task`, and `subagent`; no separate image-reading tool is added.

## Usage

Inside submitted TypeScript, call the global helper and await it:

```ts
await emitImage("screenshots/page.png");
```

Paths are resolved from the execution process's working directory. A string is a local file path, not a URL or base64 string.

The helper also accepts `Uint8Array` (including Node `Buffer`), `ArrayBuffer`, and `Blob` (including `Bun.file(...)`):

```ts
await emitImage(await Bun.file("page.png").arrayBuffer());
await emitImage(Bun.file("page.png"));

console.log("Before and after:");
await emitImage("before.png");
await emitImage("after.png");
```

Concurrent calls are serialized in call order. Use `console.log` for text; printing image JSON or base64 to stdout does **not** create an attachment. Module exports are still not returned.

## Limits and errors

- PNG, JPEG, GIF, and WebP are recognized by their byte headers, not filename extensions or a Blob's declared MIME type.
- At most **4 images**, **5,000,000 bytes per image**, and **10,000,000 bytes total** per execution, measured before base64 encoding.
- Images are not resized, cropped, converted, or fully decoded/validated. A corrupt file with a recognized header can still fail downstream. Provider-specific dimension/format limits also apply; prepare an appropriately sized image before emitting it.
- Empty, unsupported, missing, and oversized inputs reject `emitImage`. Submitted code can catch an input error and emit another image.
- Attachments are returned only on successful execution. A failed, cancelled, timed-out, or malformed execution returns no partial images. Side effects already performed by submitted code are not rolled back.
- A text-only model receives an explicit warning that attachments will be omitted from its request. Use an image-capable model for visual inspection.

Text output keeps its existing byte/line limits. Image limits are separate.

## Transport and persistence

Images use a dedicated child-process pipe (descriptor 3) rather than stdout. The parent bounds the pipe's total size, validates its records and canonical base64, and returns Pi image-content blocks. Oversized private-channel output terminates the execution rather than growing memory without bound. Ordinary logs cannot accidentally become image records.

This is transport separation and resource bounding, not an adversarial sandbox: submitted code has the user's process/filesystem permissions. The channel flag is internal and should not be set manually.

No temporary image/source files are created by this feature. Images are sent in tool content, while tool details contain only MIME types and byte counts to avoid duplicating base64. Pi's normal session persistence can retain image attachments, just as it retains other tool results. Consider that before emitting sensitive screenshots.

## Validation

Deterministic coverage exercises file/byte/Blob inputs, distinct ordered concurrent images, limits, multi-megabyte pipe writes, error recovery, malformed/flooded private output, failure/timeout handling, and unchanged ordinary execution behavior.

The opt-in Luna visual test generates a four-color PNG, verifies the actual tool image block and lack of duplicate base64 in details, and asks the model to identify the lower-right color. It answered correctly. Run it with the rest of the authenticated suite:

```sh
bun run test:llm
```

A real tmux TUI session also returned the attachment, displayed `[Image: [image/png] 320x240]`, and Luna correctly identified all four quadrant colors. No base64 appeared as text in the TUI. This validates the terminal fallback and model delivery, not native inline-image rendering in every terminal.

Local, git-ignored evidence: `artifacts/tui/image-validation-2026-09-05T00-43-13.228Z/`.
