import { LiveTransport, type LiveCallbacks } from "./transport";

type TestTransport = Pick<LiveTransport, "connect" | "close">;
/** Explicitly paid setup handshake only. Never creates audio, sends input, or dispatches tools. */
export function testLiveConnection(
  key: string,
  options: {
    signal?: AbortSignal;
    transport?: (callbacks: LiveCallbacks) => TestTransport;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transport: TestTransport | undefined;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      try {
        transport?.close();
      } catch {
        /* Never expose credential-bearing errors. */
      }
      if (success) resolve();
      else reject(new Error("Live connection test did not complete. Check key access/network and retry explicitly."));
    };
    const abort = () => finish(false);
    if (options.signal?.aborted) {
      finish(false);
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(false), options.timeoutMs ?? 15_000);
    try {
      transport = (options.transport ?? ((callbacks) => new LiveTransport(callbacks)))({
        ready: () => finish(true),
        closed: () => finish(false),
        audio: () => {},
        interrupted: () => {},
        call: () => {},
        cancelled: () => {},
      });
      if (settled) {
        transport.close();
        return;
      }
      transport.connect(key);
    } catch {
      finish(false);
    }
  });
}
