import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import net, { type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventBus, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { inspectDiagnostics } from "../src/diagnostics";
import { registerHerdrAgentState } from "../src/herdr-agent-state";

type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;
type WireRequest = { id: string; method: string; params: Record<string, unknown> };

const savedEnv = {
  HERDR_ENV: process.env.HERDR_ENV,
  HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH,
  HERDR_PANE_ID: process.env.HERDR_PANE_ID,
  DIE_SUBAGENT_DEPTH: process.env.DIE_SUBAGENT_DEPTH,
  DIE_SUBAGENT_TYPE: process.env.DIE_SUBAGENT_TYPE,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(restoreEnv);

function harness(options: { ui?: boolean; idle?: boolean; path?: string; id?: string } = {}) {
  const handlers = new Map<string, Handler[]>();
  const busHandlers = new Map<string, Set<(data: unknown) => void>>();
  const events: EventBus = {
    emit(channel, data) {
      for (const handler of busHandlers.get(channel) ?? []) handler(data);
    },
    on(channel, handler) {
      const set = busHandlers.get(channel) ?? new Set();
      set.add(handler);
      busHandlers.set(channel, set);
      return () => set.delete(handler);
    },
  };
  const pi = {
    events,
    on(name: string, handler: Handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: options.ui ?? true,
    isIdle: () => options.idle ?? true,
    sessionManager: {
      getSessionFile: () => options.path,
      getSessionId: () => options.id,
    },
  } as unknown as ExtensionContext;
  const fire = (name: string, event: Record<string, unknown> = {}) => {
    return [...(handlers.get(name) ?? [])].map((handler) => handler(event, ctx));
  };
  const fireAsync = async (name: string, event: Record<string, unknown> = {}) => {
    await Promise.all(fire(name, event));
  };
  return { pi, ctx, fire, fireAsync, events, handlers, busHandlers };
}

async function socketRecorder() {
  const dir = await mkdtemp(join(tmpdir(), "die-herdr-"));
  const path = join(dir, "herdr.sock");
  const requests: WireRequest[] = [];
  const server: Server = net.createServer((socket) => {
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString();
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      requests.push(JSON.parse(input.slice(0, newline)) as WireRequest);
      socket.end('{"ok":true}\n');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  return {
    path,
    requests,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function waitFor(predicate: () => boolean, timeout = 1500): Promise<void> {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > until) throw new Error("timed out waiting for Herdr requests");
    await Bun.sleep(10);
  }
}

function enable(path: string, depth = "0"): void {
  process.env.HERDR_ENV = "1";
  process.env.HERDR_SOCKET_PATH = path;
  process.env.HERDR_PANE_ID = "w-test:p-root";
  process.env.DIE_SUBAGENT_DEPTH = depth;
  delete process.env.DIE_SUBAGENT_TYPE;
}

describe("built-in Herdr agent state", () => {
  test("reports session refs, working/blocked/idle, monotonic seq, and release only on quit", async () => {
    const recorder = await socketRecorder();
    try {
      enable(recorder.path);
      const h = harness({ path: "/tmp/die-session.jsonl", id: "fallback", idle: true });
      registerHerdrAgentState(h.pi);
      h.fire("session_start", { reason: "startup" });
      await waitFor(() => recorder.requests.length >= 2);
      h.fire("agent_start");
      await waitFor(() => recorder.requests.some((request) => request.params.state === "working"));
      h.events.emit("herdr:blocked", { active: true, label: "approval" });
      await waitFor(() => recorder.requests.some((request) => request.params.state === "blocked"));
      h.events.emit("herdr:blocked", { active: false });
      h.fire("agent_settled");
      await waitFor(() => recorder.requests.filter((request) => request.params.state === "idle").length >= 2);
      h.fire("session_shutdown", { reason: "reload" });
      await Bun.sleep(30);
      expect(recorder.requests.some((request) => request.method === "pane.release_agent")).toBe(false);

      const replacement = harness({ id: "session-id-only", idle: true });
      registerHerdrAgentState(replacement.pi);
      replacement.fire("session_start", { reason: "resume" });
      await waitFor(() => recorder.requests.some((request) => request.params.agent_session_id === "session-id-only"));
      replacement.fire("session_shutdown", { reason: "quit" });
      await waitFor(() => recorder.requests.some((request) => request.method === "pane.release_agent"));
      expect(replacement.busHandlers.get("herdr:blocked")?.size ?? 0).toBe(0);

      const relevant = recorder.requests.filter((request) => request.params.source === "herdr:die");
      expect(relevant.every((request) => request.params.agent === "pi")).toBe(true);
      expect(relevant.find((request) => request.method === "pane.report_agent_session")?.params).toMatchObject({
        agent_session_path: "/tmp/die-session.jsonl",
        session_start_source: "startup",
      });
      const seq = relevant.map((request) => request.params.seq as number);
      expect(new Set(seq).size).toBe(seq.length);
      expect(seq.every((value, index) => index === 0 || value > seq[index - 1])).toBe(true);
    } finally {
      await recorder.close();
    }
  });

  test("replacement owns reporting and stale runtime quit cannot release it", async () => {
    const recorder = await socketRecorder();
    try {
      enable(recorder.path);
      const oldRuntime = harness({ id: "old" });
      registerHerdrAgentState(oldRuntime.pi);
      oldRuntime.fire("session_start", { reason: "startup" });
      await waitFor(() => recorder.requests.length >= 2);
      const replacement = harness({ id: "new" });
      registerHerdrAgentState(replacement.pi);
      replacement.fire("session_start", { reason: "resume" });
      await waitFor(() => recorder.requests.some((request) => request.params.agent_session_id === "new"));
      oldRuntime.fire("session_shutdown", { reason: "quit" });
      oldRuntime.fire("agent_start");
      await Bun.sleep(40);
      expect(recorder.requests.some((request) => request.method === "pane.release_agent")).toBe(false);
      expect(recorder.requests.filter((request) => request.params.agent_session_id === "old").length).toBe(2);
      replacement.fire("session_shutdown", { reason: "quit" });
      await waitFor(() => recorder.requests.some((request) => request.method === "pane.release_agent"));
    } finally {
      await recorder.close();
    }
  });

  test("quit drops queued working before release when a socket is stalled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-herdr-stall-"));
    const path = join(dir, "herdr.sock");
    const requests: WireRequest[] = [];
    const server = net.createServer((socket) => {
      let input = "";
      socket.on("data", (chunk) => {
        input += chunk.toString();
        const newline = input.indexOf("\n");
        if (newline < 0) return;
        const request = JSON.parse(input.slice(0, newline)) as WireRequest;
        requests.push(request);
        if (request.method === "pane.release_agent") socket.end('{"ok":true}\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      enable(path);
      const h = harness({ id: "stalled" });
      registerHerdrAgentState(h.pi);
      h.fire("session_start", { reason: "startup" });
      await waitFor(() => requests.length === 1);
      h.fire("agent_start");
      h.fire("session_shutdown", { reason: "quit" });
      await waitFor(() => requests.some((request) => request.method === "pane.release_agent"));
      expect(requests.some((request) => request.params.state === "working")).toBe(false);
      expect(requests.at(-1)?.method).toBe("pane.release_agent");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("is disabled for inherited child workers and non-UI sessions", async () => {
    const recorder = await socketRecorder();
    try {
      enable(recorder.path, "1");
      const child = harness();
      registerHerdrAgentState(child.pi);
      expect(child.handlers.size).toBe(0);

      enable(recorder.path, "0");
      const print = harness({ ui: false });
      registerHerdrAgentState(print.pi);
      print.fire("session_start", { reason: "startup" });
      print.fire("agent_start");
      await Bun.sleep(30);
      expect(recorder.requests).toHaveLength(0);
      print.fire("session_shutdown", { reason: "quit" });
    } finally {
      await recorder.close();
    }
  });

  test("unavailable endpoints and synchronous connector failures are nonfatal and prompt", async () => {
    const missing = join(tmpdir(), "die-herdr-missing-" + Math.random().toString(36).slice(2) + ".sock");
    enable(missing);
    const unavailable = harness({ id: "offline" });
    registerHerdrAgentState(unavailable.pi);
    const started = performance.now();
    unavailable.fire("session_start", { reason: "startup" });
    expect(performance.now() - started).toBeLessThan(50);
    unavailable.fire("session_shutdown", { reason: "reload" });

    const throwing = harness({ id: "throwing" });
    registerHerdrAgentState(throwing.pi, () => {
      throw new Error("synchronous socket failure");
    });
    expect(() => throwing.fire("session_start", { reason: "startup" })).not.toThrow();
    await Bun.sleep(10);
    expect(inspectDiagnostics(throwing.ctx.sessionManager as object).records).toContainEqual({
      component: "herdr",
      code: "delivery_failed",
      outcome: "failed",
      dispatch: "initiated",
    });
    throwing.fire("session_shutdown", { reason: "quit" });
    await Bun.sleep(20);
  });

  test("stalled sends preserve wire sequence order and the final working state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-herdr-order-"));
    const path = join(dir, "herdr.sock");
    const requests: WireRequest[] = [];
    let stallFirst = true;
    const server = net.createServer((socket) => {
      let input = "";
      socket.on("data", (chunk) => {
        input += chunk.toString();
        const newline = input.indexOf("\n");
        if (newline < 0) return;
        requests.push(JSON.parse(input.slice(0, newline)) as WireRequest);
        if (stallFirst) stallFirst = false;
        else socket.end('{"ok":true}\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      enable(path);
      const h = harness({ id: "ordered", idle: true });
      registerHerdrAgentState(h.pi);
      h.fire("session_start", { reason: "startup" });
      await waitFor(() => requests.length === 1);
      h.fire("agent_start");
      h.fire("agent_start");
      h.fire("agent_start");
      await waitFor(() => requests.some((request) => request.params.state === "working"), 2500);
      await waitFor(
        () => requests.filter((request) => request.method === "pane.report_agent_session").length >= 2,
        2500,
      );
      const seq = requests.map((request) => request.params.seq as number);
      expect(seq.every((value, index) => index === 0 || value > seq[index - 1]!)).toBe(true);
      expect(requests.some((request) => request.params.state === "idle")).toBe(false);
      expect(requests.filter((request) => request.params.state === "working")).toHaveLength(1);
      await h.fireAsync("session_shutdown", { reason: "reload" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("quit is awaited and a concurrent replacement cancels release retries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-herdr-replace-"));
    const path = join(dir, "herdr.sock");
    const requests: WireRequest[] = [];
    const server = net.createServer((socket) => {
      let input = "";
      socket.on("data", (chunk) => {
        input += chunk.toString();
        const newline = input.indexOf("\n");
        if (newline < 0) return;
        const request = JSON.parse(input.slice(0, newline)) as WireRequest;
        requests.push(request);
        if (request.method !== "pane.release_agent") socket.end('{"ok":true}\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      enable(path);
      const oldRuntime = harness({ id: "old-concurrent" });
      registerHerdrAgentState(oldRuntime.pi);
      oldRuntime.fire("session_start", { reason: "startup" });
      await waitFor(() => requests.length >= 2);
      let quitFinished = false;
      const quitting = oldRuntime.fireAsync("session_shutdown", { reason: "quit" }).then(() => {
        quitFinished = true;
      });
      await waitFor(() => requests.some((request) => request.method === "pane.release_agent"));
      expect(quitFinished).toBe(false);

      const replacement = harness({ id: "new-concurrent" });
      registerHerdrAgentState(replacement.pi);
      replacement.fire("session_start", { reason: "resume" });
      await quitting;
      await waitFor(() => requests.some((request) => request.params.agent_session_id === "new-concurrent"));
      const firstNew = requests.findIndex((request) => request.params.agent_session_id === "new-concurrent");
      expect(requests.slice(firstNew).some((request) => request.method === "pane.release_agent")).toBe(false);
      await replacement.fireAsync("session_shutdown", { reason: "reload" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("non-quit restart reattaches one blocked listener and bounds outbound metadata", async () => {
    const recorder = await socketRecorder();
    try {
      enable(recorder.path);
      process.env.HERDR_PANE_ID = "p".repeat(800);
      const h = harness({ id: "i".repeat(800) });
      registerHerdrAgentState(h.pi);
      h.fire("session_start", { reason: "startup" });
      await waitFor(() => recorder.requests.length >= 2);
      await h.fireAsync("session_shutdown", { reason: "resume" });
      expect(h.busHandlers.get("herdr:blocked")?.size ?? 0).toBe(0);
      h.fire("session_start", { reason: "resume" });
      expect(h.busHandlers.get("herdr:blocked")?.size ?? 0).toBe(1);
      h.events.emit("herdr:blocked", { active: true, label: "x".repeat(2000) + "\u0000tail" });
      await waitFor(() => recorder.requests.some((request) => request.params.state === "blocked"));
      const blocked = [...recorder.requests].reverse().find((request) => request.params.state === "blocked");
      if (!blocked) throw new Error("missing blocked report");
      expect((blocked.params.pane_id as string).length).toBe(512);
      expect((blocked.params.agent_session_id as string).length).toBe(512);
      expect((blocked.params.message as string).length).toBe(512);
      h.fire("session_start", { reason: "reload" });
      expect(h.busHandlers.get("herdr:blocked")?.size ?? 0).toBe(1);
      await h.fireAsync("session_shutdown", { reason: "reload" });
    } finally {
      await recorder.close();
    }
  });

  test("malformed depth and spawned role fail closed", () => {
    enable("/tmp/unused-herdr.sock", "garbage");
    const malformed = harness();
    registerHerdrAgentState(malformed.pi);
    expect(malformed.handlers.size).toBe(0);

    enable("/tmp/unused-herdr.sock", "0");
    process.env.DIE_SUBAGENT_TYPE = "normal";
    const spawned = harness();
    registerHerdrAgentState(spawned.pi);
    expect(spawned.handlers.size).toBe(0);
  });
});
