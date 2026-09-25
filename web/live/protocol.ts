import type { TransportMessage } from "./controller";

/** Dedicated ordered socket only, binaryType=arraybuffer. No provider JSON or keys. */
export function decodeRelayMessage(data: unknown): TransportMessage {
  if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
    const pcm16 = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (!pcm16.byteLength || pcm16.byteLength % 2 || pcm16.byteLength > 9600) throw new Error("Invalid audio frame");
    return { type: "audio", pcm16 };
  }
  if (typeof data !== "string" || data.length > 256) throw new Error("Invalid voice control");
  const value = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid voice control");
  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "interrupted":
      if (!Number.isSafeInteger(value.epoch) || value.epoch < 1) throw new Error("Invalid interruption epoch");
      return { type: "interrupted" };
    case "closed":
      return { type: "closed", reason: "Voice connection closed" };
    case "error":
      // Do not render arbitrary remote/provider error strings.
      return { type: "error", reason: "Voice connection failed" };
    default:
      throw new Error("Unknown voice control");
  }
}
