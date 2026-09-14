import { read, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
let sequence = 1;
const pending = new Map();
let responseBuffer = "";
let reading = false;
function failAll(error) {
  for (const item of pending.values()) item.reject(error);
  pending.clear();
}
function consumeResponses() {
  for (;;) {
    const newline = responseBuffer.indexOf("\n"); if (newline < 0) break;
    const line = responseBuffer.slice(0, newline); responseBuffer = responseBuffer.slice(newline + 1);
    let frame;
    try { frame = JSON.parse(line); } catch { failAll(new Error("Invalid job bridge response JSON")); return false; }
    const item = pending.get(frame.id);
    if (!item) { failAll(new Error("Job bridge response ID mismatch")); return false; }
    pending.delete(frame.id);
    try { writeSync(3, JSON.stringify({ ack: frame.id }) + "\n"); }
    catch { item.reject(new Error("Job bridge disconnected")); continue; }
    if (frame.error != null) item.reject(Object.assign(new Error(frame.error), { code: frame.code }));
    else item.resolve(frame.result);
  }
  if (Buffer.byteLength(responseBuffer) > 1048576) { failAll(new Error("Job bridge response exceeds 1 MB")); return false; }
  return true;
}
function pump() {
  if (reading || pending.size === 0) return;
  reading = true;
  const chunk = Buffer.allocUnsafe(65536);
  read(4, chunk, 0, chunk.length, null, (error, count) => {
    reading = false;
    if (error || !count) { failAll(new Error("Job bridge disconnected")); return; }
    responseBuffer += chunk.subarray(0, count).toString("utf8");
    if (consumeResponses()) pump();
  });
}
function rpc(method, args = {}) {
  const id = sequence++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      const line = JSON.stringify({ id, method, args }) + "\n";
      if (Buffer.byteLength(line) > 1048576) throw new Error("Job bridge request exceeds 1 MB");
      writeSync(3, line);
      pump();
    } catch (error) { pending.delete(id); reject(error); }
  });
}
function options(value, required) {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error("Job options must be an object");
  return { ...(value || {}), ...required };
}
globalThis.shell = (command, opts) => rpc("shell", options(opts, { command }));
globalThis.subagent = opts => rpc("subagent", opts || {});
globalThis.jobs = {
  list: opts => rpc("jobs.list", opts || {}),
  inspect: (id, opts) => rpc("jobs.inspect", options(opts, { id })),
  input: (id, data, opts) => rpc("jobs.input", options(opts, { id, data })),
  stop: id => rpc("jobs.stop", { id }), snooze: (id, opts) => rpc("jobs.snooze", options(opts, { id })),
  setWatch: (id, opts) => rpc("jobs.setWatch", options(opts, { id })), closeInput: id => rpc("jobs.closeInput", { id }),
};
globalThis.history = { search: input => rpc("history.search", input), read: input => rpc("history.read", input) };
globalThis.goal = { get: () => rpc("goal.get", {}), set: input => rpc("goal.set", input), update: input => rpc("goal.update", input), clear: () => rpc("goal.clear", {}) };
globalThis.handoff = async message => { await rpc("handoff", { message }); process.exit(0); };
function mime(bytes) {
  if (bytes.length>=33 && bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4e && bytes[3]===0x47) return "image/png";
  if (bytes.length>=4 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return "image/jpeg";
  if (bytes.length>=20 && bytes[0]===0x52 && bytes[1]===0x49 && bytes[8]===0x57 && bytes[9]===0x45) return "image/webp";
  throw new Error("showImage supports PNG, JPEG, and WebP bytes; unsupported or missing image header");
}
let photonPromise;
async function resizeOversized(bytes) {
  const dir = process.env.GODIE_PHOTON_DIR;
  if (!dir) throw new Error("showImage resizer is unavailable");
  photonPromise ||= import(pathToFileURL(join(dir, "photon_rs.js")).href);
  const imported = await photonPromise; const photon = imported.default || imported;
  let image;
  try {
    image = photon.PhotonImage.new_from_byteslice(bytes);
    const originalWidth=image.get_width(), originalHeight=image.get_height();
    let width=originalWidth, height=originalHeight;
    if(width>2000){height=Math.max(1,Math.round(height*2000/width));width=2000}
    if(height>2000){width=Math.max(1,Math.round(width*2000/height));height=2000}
    for (;;) {
      const resized=photon.resize(image,width,height,photon.SamplingFilter.Lanczos3);
      try {
        const candidates=[resized.get_bytes(), ...[80,85,70,55,40].map(q=>resized.get_bytes_jpeg(q))];
        for(const candidate of candidates){ const out=new Uint8Array(candidate); if(out.byteLength<=5000000) return {bytes:out, resize:{originalWidth,originalHeight,width,height}}; }
      } finally { resized.free(); }
      if(width===1&&height===1) break;
      width=width===1?1:Math.max(1,Math.floor(width*.75)); height=height===1?1:Math.max(1,Math.floor(height*.75));
    }
  } finally { image?.free(); }
  throw new Error("showImage could not resize image below 5 MB");
}
let imageQueue=Promise.resolve(), imageCount=0, imageTotal=0;
globalThis.showImage = input => {
  const operation=imageQueue.then(async()=>{
    if(imageCount>=4) throw new Error("showImage allows at most 4 images per execution");
    let bytes;
    if (typeof input === "string") { const blob=Bun.file(input); if(!(await blob.exists())) throw new Error("Image file not found: "+input); if(blob.size>25000000) throw new Error("Image input exceeds 25 MB"); bytes = new Uint8Array(await blob.arrayBuffer()); }
    else if (input instanceof Blob) bytes = new Uint8Array(await input.arrayBuffer());
    else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
    else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    else throw new Error("showImage expects a path, Blob, ArrayBuffer, or typed array");
    if (bytes.byteLength === 0 || bytes.byteLength > 25000000) throw new Error("Image input must be between 1 byte and 25 MB");
    let mimeType=mime(bytes), resize;
    if(bytes.byteLength>5000000){const result=await resizeOversized(bytes);bytes=result.bytes;resize=result.resize;mimeType=mime(bytes)}
    if(imageTotal+bytes.byteLength>10000000) throw new Error("showImage total exceeds 10 MB");
    writeSync(5, JSON.stringify({ mimeType, data: Buffer.from(bytes).toString("base64"), ...(resize?{resize}:{}) }) + "\n");
    imageCount++; imageTotal+=bytes.byteLength;
  });
  imageQueue=operation.catch(()=>{}); return operation;
};

