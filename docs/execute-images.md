# Image results from `execute`

`execute` can return model-visible image attachments as well as stdout/stderr. The model-facing tool remains `execute`; `showImage` is a helper inside it, not a separate image-reading tool.

## Usage

Inside submitted TypeScript, call the global helper and await it:

```ts
await showImage("screenshots/page.png");
```

Paths are resolved from the execution process's working directory. A string is a local file path, not a URL or base64 string.

The helper also accepts `Uint8Array` (including Node `Buffer`), `ArrayBuffer`, and `Blob` (including `Bun.file(...)`):

```ts
await showImage(await Bun.file("page.png").arrayBuffer());
await showImage(Bun.file("page.png"));

console.log("Before and after:");
await showImage("before.png");
await showImage("after.png");
```

Concurrent calls are serialized in call order. Use `console.log` for text; printing image JSON or base64 to stdout does **not** create an attachment. Module exports are still not returned.

## Limits and errors

- PNG, JPEG, and WebP are recognized by their byte headers, not filename extensions or a Blob's declared MIME type. GIF is unsupported and rejected; frames are not converted.
- Inputs are bounded to **25,000,000 bytes**. File/Blob size is checked before reading, and reads remain bounded if a file grows. Larger input is rejected.
- At most **4 output images**, **5,000,000 bytes per image**, and **10,000,000 bytes total** per execution, measured after helper resizing and before base64 encoding.
- Inputs over 5 MB are automatically resized/re-encoded through Pi's existing resizer (PNG/JPEG output as needed, aspect ratio preserved, Pi's default maximum dimensions of 2000×2000). Original files and caller-supplied bytes are unchanged. A failed resize rejects rather than passing an oversized image through.
- Inputs already within the helper's byte limit are not decoded or changed by the helper. Pi's downstream tool-result image processing may still resize/convert them according to its auto-resize setting and provider constraints. Header recognition alone is not full image validation.
- For helper-resized images, the tool result includes original/output dimensions and a coordinate scale. Pi may provide its own further dimension note if downstream processing changes the image again.
- Empty, unsupported, missing, over-ceiling inputs and unsuccessful resizes reject `showImage`. Submitted code can catch an input error and emit another image.
- Attachments are returned only on successful execution. A failed, cancelled, timed-out, or malformed execution returns no partial images. Side effects already performed by submitted code are not rolled back.
- A text-only model receives an explicit warning that attachments will be omitted from its request. Use an image-capable model for visual inspection.

Text output keeps its existing byte/line limits. Image limits are separate.

## Transport and persistence

The standalone binary embeds Photon WASM for Pi's resize fallback; no installed dependency files or external image-conversion commands are needed for helper resizing. Pi is loaded lazily for oversized inputs.

Images use a dedicated child-process pipe (descriptor 3) rather than stdout. The parent bounds the pipe's total size, validates its records and canonical base64, and returns Pi image-content blocks. Oversized private-channel output terminates the execution rather than growing memory without bound. Ordinary logs cannot accidentally become image records.

This is transport separation and resource bounding, not an adversarial sandbox: submitted code has the user's process/filesystem permissions. The channel flag is internal and should not be set manually.

No temporary image/source files are created by this feature. Images are sent in tool content, while tool details contain MIME types, byte counts, and any resize notes without duplicating base64. Pi's normal session persistence can retain image attachments, just as it retains other tool results. Consider that before emitting sensitive screenshots.

## Validation

Deterministic coverage exercises file/byte/Blob inputs, distinct ordered concurrent images, limits, multi-megabyte pipe writes, error recovery, malformed/flooded private output, failure/timeout handling, and unchanged ordinary execution behavior.

The following live-model/TUI results are historical, from before the helper rename; the rename does not claim a new paid visual run.

The opt-in Luna visual test generates a four-color PNG, verifies the actual tool image block and lack of duplicate base64 in details, and asks the model to identify the lower-right color. It answered correctly. Run it with the rest of the authenticated suite:

```sh
bun run test:llm
```

A real tmux TUI session also returned the attachment, displayed `[Image: [image/png] 320x240]`, and Luna correctly identified all four quadrant colors. No base64 appeared as text in the TUI. This validates the terminal fallback and model delivery, not native inline-image rendering in every terminal.

Local, git-ignored evidence: `artifacts/tui/image-validation-2026-09-05T00-43-13.228Z/`.
