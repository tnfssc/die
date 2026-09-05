import { Duplex } from "node:stream";
import type { ChildProcess } from "node:child_process";

export const JOB_BRIDGE_ENV = "DIE_JOB_BRIDGE";
export const MAX_JOB_BRIDGE_FRAME_BYTES = 1024 * 1024;

type JobHandler = (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;
type Request = { id: number; method: string; params: unknown };
type Acknowledgement = { ack: number };
type Response = { id: number; result?: unknown; error?: string };

type Options = Record<string, unknown>;

export const JOB_RESPONSE_ACK_EVENT = "die:job-response-ack";
const ACK_CAPABLE = Symbol.for("die.job-response-ack-capable");

const RESPONSE_DELIVERY_SIGNAL = Symbol.for("die.job-response-delivery-signal");
type AckCapableSignal = AbortSignal & {
  [ACK_CAPABLE]?: boolean;
  [RESPONSE_DELIVERY_SIGNAL]?: AbortSignal;
};

/** Return the bridge signal whose lifetime describes response delivery. */
export function getJobResponseDeliverySignal(signal?: AbortSignal): AbortSignal | undefined {
  return signal ? (signal as AckCapableSignal)[RESPONSE_DELIVERY_SIGNAL] ?? signal : undefined;
}

/** True when a handler signal can acknowledge that its result reached the worker. */
export function supportsJobResponseAcknowledgement(signal?: AbortSignal): boolean {
  const deliverySignal = getJobResponseDeliverySignal(signal);
  return !!deliverySignal && (deliverySignal as AckCapableSignal)[ACK_CAPABLE] === true;
}

/**
 * Add local cancellation without losing the bridge signal's delivery identity.
 * Delivery identity is carried separately: AbortSignal.any() only preserves
 * abort state, and local wait cancellation must not revoke inline delivery.
 */
export function withJobCancellation(signal: AbortSignal, cancellation: AbortSignal): AbortSignal {
  if (signal === cancellation) return signal;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const deliverySignal = getJobResponseDeliverySignal(signal)!;
  const cleanup = (): void => {
    signal.removeEventListener("abort", abort);
    cancellation.removeEventListener("abort", abort);
    deliverySignal.removeEventListener(JOB_RESPONSE_ACK_EVENT, cleanup);
  };
  signal.addEventListener("abort", abort, { once: true });
  cancellation.addEventListener("abort", abort, { once: true });
  controller.signal.addEventListener("abort", cleanup, { once: true });
  Object.defineProperty(controller.signal, RESPONSE_DELIVERY_SIGNAL, { value: deliverySignal });
  // A clean acknowledgement is also the end of this wrapper's lifetime. The
  // TaskManager listens to deliverySignal directly; it must not mistake local
  // wait cancellation (for example, handoff) for a bridge disconnect.
  if (supportsJobResponseAcknowledgement(deliverySignal)) {
    deliverySignal.addEventListener(JOB_RESPONSE_ACK_EVENT, cleanup, { once: true });
  }
  if (signal.aborted || cancellation.aborted) abort();
  return controller.signal;
}

export interface ExecuteJobGlobals {
  shell(command: string, options?: Options): Promise<unknown>;
  subagent(options: Options): Promise<unknown>;
  handoff(message: string): Promise<never>;
  jobs: {
    list(options?: Options): Promise<unknown>;
    inspect(id: string, options?: Options): Promise<unknown>;
    input(id: string, data?: unknown, options?: Options): Promise<unknown>;
    stop(id: string): Promise<unknown>;
    closeInput(id: string): Promise<unknown>;
  };
}

declare global {
  var shell: ExecuteJobGlobals["shell"];
  var subagent: ExecuteJobGlobals["subagent"];
  var handoff: ExecuteJobGlobals["handoff"];
  var jobs: ExecuteJobGlobals["jobs"];
}

/** Signals an acknowledged cooperative handoff to the execute runner. */
export class HandoffSignal extends Error {
  constructor() {
    super("Execution handed off cooperatively");
    this.name = "HandoffSignal";
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function combine(options: Options | undefined, required: Options): Options {
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options))) throw new Error("Job options must be an object");
  return { ...(options ?? {}), ...required };
}

/** Install execute's job helpers. With no bridge, calls reject with a useful error. */
export function installJobGlobals(socket?: Duplex): { finish(): Promise<void> } {
  let nextId = 1;
  let input = Buffer.alloc(0);
  let closed = !socket;
  let finishing = false;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; promise: Promise<unknown> }>();
  const unavailable = "Job bridge is unavailable for this execute call";

  const rejectAll = (reason: string) => {
    if (closed) return;
    closed = true;
    for (const item of pending.values()) item.reject(new Error(reason));
    pending.clear();
  };

  const failProtocol = (reason: string) => {
    rejectAll(reason);
    socket?.destroy();
  };

  if (socket) {
    const acknowledge = (id: number, item: { resolve(value: unknown): void; reject(error: Error): void }) => {
      const line = JSON.stringify({ ack: id }) + "\n";
      try {
        socket.write(line, (error?: Error | null) => {
          if (!pending.delete(id)) return;
          if (error) item.reject(new Error("Job bridge disconnected"));
          else item.resolve(undefined);
        });
      } catch {
        if (pending.delete(id)) item.reject(new Error("Job bridge disconnected"));
      }
    };
    socket.on("data", (chunk: Buffer) => {
      if (closed) return;
      if (input.length + chunk.length > MAX_JOB_BRIDGE_FRAME_BYTES && !chunk.includes(10)) {
        failProtocol("Job bridge response exceeded 1 MB");
        return;
      }
      input = Buffer.concat([input, chunk]);
      for (;;) {
        const newline = input.indexOf(10);
        if (newline < 0) {
          if (input.length > MAX_JOB_BRIDGE_FRAME_BYTES) failProtocol("Job bridge response exceeded 1 MB");
          return;
        }
        const frame = input.subarray(0, newline);
        input = input.subarray(newline + 1);
        if (frame.length > MAX_JOB_BRIDGE_FRAME_BYTES) {
          failProtocol("Job bridge response exceeded 1 MB");
          return;
        }
        let value: unknown;
        try { value = JSON.parse(frame.toString("utf8")); }
        catch { failProtocol("Invalid job bridge response JSON"); return; }
        if (!value || typeof value !== "object") { failProtocol("Invalid job bridge response envelope"); return; }
        const response = value as Response;
        if (!Number.isSafeInteger(response.id) || !("result" in response || typeof response.error === "string") || ("result" in response && "error" in response)) {
          failProtocol("Invalid job bridge response envelope");
          return;
        }
        const item = pending.get(response.id);
        if (!item) { failProtocol("Unknown job bridge response id"); return; }
        if (typeof response.error === "string") {
          // Error results own no task completion, but acknowledge them to release
          // the server-side request signal consistently.
          const error = new Error(response.error);
          acknowledge(response.id, { resolve: () => item.reject(error), reject: item.reject });
        } else {
          const result = response.result;
          acknowledge(response.id, { resolve: () => item.resolve(result), reject: item.reject });
        }
      }
    });
    socket.on("end", () => rejectAll("Job bridge disconnected"));
    socket.on("close", () => rejectAll("Job bridge disconnected"));
    socket.on("error", () => rejectAll("Job bridge disconnected"));
  }

  const request = (method: string, params: unknown): Promise<unknown> => {
    if (!socket || closed || finishing) return Promise.reject(new Error(socket ? "Job bridge is closing" : unavailable));
    const id = nextId++;
    let line: string;
    try { line = JSON.stringify({ id, method, params: params ?? null }) + "\n"; }
    catch (error) { return Promise.reject(new Error(`Could not encode job bridge request: ${message(error)}`)); }
    if (Buffer.byteLength(line) > MAX_JOB_BRIDGE_FRAME_BYTES) return Promise.reject(new Error("Job bridge request exceeded 1 MB"));
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
    pending.set(id, { resolve, reject, promise });
    try {
      socket.write(line, (error?: Error | null) => {
        if (error && pending.delete(id)) reject(new Error("Job bridge disconnected"));
      });
    } catch {
      pending.delete(id);
      reject(new Error("Job bridge disconnected"));
    }
    return promise;
  };

  const globals: ExecuteJobGlobals = {
    shell: async (command, options) => request("shell", combine(options, { command })),
    subagent: async (options) => request("subagent", options),
    handoff: async (message): Promise<never> => {
      await request("handoff", { message });
      throw new HandoffSignal();
    },
    jobs: {
      list: async (options) => request("jobs.list", options ?? {}),
      inspect: async (id, options) => request("jobs.inspect", combine(options, { id })),
      input: async (id, data, options) => request("jobs.input", combine(options, { id, data })),
      stop: async (id) => request("jobs.stop", { id }),
      closeInput: async (id) => request("jobs.closeInput", { id }),
    },
  };
  Object.assign(globalThis, globals);

  return {
    async finish() {
      finishing = true;
      while (pending.size) await Promise.allSettled([...pending.values()].map((item) => item.promise));
      if (socket && !closed) {
        socket.end();
        socket.destroy();
      }
    },
  };
}

/** Adapt the private Node/Bun IPC channel to the framed bridge protocol. */
function ipcStream(endpoint: NodeJS.Process | ChildProcess): Duplex {
  const onMessage = (value: unknown) => {
    if (typeof value === "string") stream.push(Buffer.from(value));
    else stream.destroy(new Error("Invalid job IPC payload"));
  };
  const onDisconnect = () => stream.push(null);
  const disconnect = () => {
    endpoint.off("message", onMessage);
    endpoint.off("disconnect", onDisconnect);
    if (endpoint.connected) { try { endpoint.disconnect?.(); } catch {} }
  };
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      if (!endpoint.connected || !endpoint.send) { callback(new Error("Job bridge disconnected")); return; }
      try { (endpoint.send as (message: string, callback: (error: Error | null) => void) => boolean).call(endpoint, chunk.toString("utf8"), error => callback(error)); }
      catch (error) { callback(error as Error); }
    },
    final(callback) { disconnect(); callback(); },
    destroy(error, callback) { disconnect(); callback(error); },
  });
  endpoint.on("message", onMessage);
  endpoint.on("disconnect", onDisconnect);
  return stream;
}
export function openWorkerJobBridge(): Duplex | undefined {
  if (process.env[JOB_BRIDGE_ENV] !== "1") return undefined;
  if (!process.send) throw new Error("Job IPC channel is unavailable");
  return ipcStream(process);
}
export function openParentJobBridge(child: ChildProcess): Duplex { return ipcStream(child); }

/** Serve worker requests over the private IPC channel. */
export function serveJobBridge(socket: Duplex, handler: JobHandler, executionSignal: AbortSignal): { close(commitAcknowledgements?: boolean): void } {
  let input = Buffer.alloc(0);
  let lastId = 0;
  let closed = false;
  const controller = new AbortController();
  type ServedRequest = { controller: AbortController; reply: "pending" | "sent" | "acked" | "failed" };
  const requests = new Map<number, ServedRequest>();
  const abortRequests = () => {
    controller.abort();
    for (const request of requests.values()) request.controller.abort();
    requests.clear();
  };
  const abort = () => abortRequests();
  const disconnect = () => {
    // A graceful worker bridge shutdown commonly precedes the child "close"
    // event. Preserve provisional ACKs until executeIsolated can commit or
    // reject them from the worker exit status; all other requests lost delivery.
    for (const [id, request] of requests) {
      if (request.reply === "acked") continue;
      request.controller.abort();
      requests.delete(id);
    }
  };
  executionSignal.addEventListener("abort", abort, { once: true });
  if (executionSignal.aborted) abort();
  socket.on("error", abort); // In particular, consume EPIPE rather than emitting it uncaught.
  socket.on("end", disconnect);
  socket.on("close", disconnect);

  const close = (commitAcknowledgements = false) => {
    if (closed) return;
    closed = true;
    executionSignal.removeEventListener("abort", abort);
    // ACK only becomes ownership transfer when the execute worker itself has
    // completed successfully. Receipt merely proves the worker got one RPC
    // reply; committing at clean worker exit prevents a crash immediately after
    // ACK from swallowing the task's session completion notification.
    if (commitAcknowledgements) {
      for (const request of requests.values()) {
        if (request.reply === "acked") request.controller.signal.dispatchEvent(new Event(JOB_RESPONSE_ACK_EVENT));
      }
    }
    abortRequests();
    socket.destroy();
  };
  const fail = (reason: string) => {
    if (closed) return;
    closed = true;
    executionSignal.removeEventListener("abort", abort);
    abortRequests();
    socket.destroy(new Error(reason));
  };
  const send = (id: number, response: Response, ownsResult = true) => {
    const request = requests.get(id);
    if (!request || closed || socket.destroyed) {
      request?.controller.abort();
      requests.delete(id);
      return;
    }
    let line: string;
    let fallback = !ownsResult;
    // A handler error means the RPC response contains no foreground result.
    // Release notification ownership even if the worker receives and ACKs the
    // error frame successfully.
    if (!ownsResult) {
      request.reply = "failed";
      request.controller.abort();
    }
    try { line = JSON.stringify(response) + "\n"; }
    catch (error) {
      fallback = true;
      line = JSON.stringify({ id: response.id, error: `Could not encode job result: ${message(error)}` }) + "\n";
    }
    if (Buffer.byteLength(line) > MAX_JOB_BRIDGE_FRAME_BYTES) {
      fallback = true;
      line = JSON.stringify({ id: response.id, error: "Job bridge response exceeded 1 MB" }) + "\n";
    }
    // A fallback reply does not contain the selected foreground result, so it
    // cannot own completion even if the worker acknowledges the error frame.
    if (fallback) {
      request.reply = "failed";
      request.controller.abort();
    } else request.reply = "sent";
    try {
      socket.write(line, error => {
        if (error) {
          request.controller.abort();
          requests.delete(id);
        }
      });
    } catch {
      request.controller.abort();
      requests.delete(id);
    }
  };

  socket.on("data", (chunk: Buffer) => {
    if (closed) return;
    input = Buffer.concat([input, chunk]);
    for (;;) {
      const newline = input.indexOf(10);
      if (newline < 0) {
        if (input.length > MAX_JOB_BRIDGE_FRAME_BYTES) fail("Job bridge request exceeded 1 MB");
        return;
      }
      const frame = input.subarray(0, newline);
      input = input.subarray(newline + 1);
      if (frame.length > MAX_JOB_BRIDGE_FRAME_BYTES) { fail("Job bridge request exceeded 1 MB"); return; }
      let value: unknown;
      try { value = JSON.parse(frame.toString("utf8")); }
      catch { fail("Invalid job bridge request JSON"); return; }
      if (!value || typeof value !== "object") { fail("Invalid job bridge request envelope"); return; }
      if ("ack" in value) {
        const acknowledgement = value as Acknowledgement;
        if (!Number.isSafeInteger(acknowledgement.ack)) { fail("Invalid job bridge acknowledgement"); return; }
        const request = requests.get(acknowledgement.ack);
        // ACK before a normal reply, replayed ACK, and unknown ACK are protocol
        // failures. abortRequests() also releases every TaskManager listener.
        if (!request) { fail("Unknown or duplicate job bridge acknowledgement id"); return; }
        if (request.reply === "failed") {
          // The worker received the bounded error fallback. There is no task
          // result to commit, and abort above already released its listeners.
          requests.delete(acknowledgement.ack);
          continue;
        }
        if (request.reply !== "sent") { fail("Unknown or duplicate job bridge acknowledgement id"); return; }
        request.reply = "acked";
        continue;
      }
      const request = value as Request;
      if (!Number.isSafeInteger(request.id) || request.id <= lastId || typeof request.method !== "string" || !("params" in request)) {
        fail("Invalid job bridge request envelope"); return;
      }
      lastId = request.id;
      const requestController = new AbortController();
      Object.defineProperty(requestController.signal, ACK_CAPABLE, { value: true });
      requests.set(request.id, { controller: requestController, reply: "pending" });
      if (controller.signal.aborted) requestController.abort();
      void Promise.resolve().then(() => handler(request.method, request.params, requestController.signal)).then(
        result => send(request.id, { id: request.id, result: result === undefined ? null : result }),
        error => send(request.id, { id: request.id, error: message(error) }, false),
      );
    }
  });
  return { close };
}
