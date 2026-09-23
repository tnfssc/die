import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import liveExtension from "../src/live/extension";
import type { LiveCallbacks } from "../src/live/transport";

const flush = () => new Promise<void>((done) => setTimeout(done, 0));
function fixture(local = true) {
  const choices: (string | undefined)[] = [];
  let credentialChecks = 0,
    imports = 0;
  const handlers = new Map<string, Set<(event: any) => unknown>>();
  let command: any;
  const sent: { text: string; options: unknown }[] = [];
  let keyReads = 0,
    connects = 0,
    audioStarts = 0,
    audioCloses = 0,
    socketCloses = 0,
    aborts = 0,
    interrupts = 0;
  const responses: unknown[][] = [];
  const played: string[] = [],
    captured: string[] = [];
  let callbacks!: LiveCallbacks;
  let capture!: (data: string) => void;
  const statuses = new Map<string, string | undefined>();
  const notices: string[] = [];
  const api = {
    on: (name: string, handler: (event: any) => unknown) => {
      let set = handlers.get(name);
      if (!set) {
        set = new Set();
        handlers.set(name, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
    registerCommand: (_name: string, value: unknown) => {
      command = value;
    },
    sendUserMessage: (text: string, options: unknown) => {
      sent.push({ text, options });
      return new Promise<void>(() => {}); // configured coding agent is still working
    },
  } as unknown as ExtensionAPI;
  liveExtension(api, {
    local: () => local,
    capabilities: async () => ({ supported: true, requirements: "fake devices" }),
    credentialStatus: async () => {
      credentialChecks++;
      return { configured: true, canImport: false, message: "Google key configured" };
    },
    importKey: async () => {
      imports++;
    },
    key: async () => {
      keyReads++;
      return "FAKE-never-used-key";
    },
    audio: () => ({
      start: async (onAudio) => {
        audioStarts++;
        capture = onAudio;
      },
      play: (data) => {
        played.push(data);
      },
      interrupt: () => {
        interrupts++;
      },
      close: () => {
        audioCloses++;
      },
    }),
    transport: (cb) => {
      callbacks = cb;
      return {
        connect: () => {
          connects++;
        },
        sendAudio: (data) => {
          captured.push(data);
        },
        respond: (...args) => {
          responses.push(args);
        },
        close: () => {
          socketCloses++;
        },
      };
    },
  });
  const ctx = {
    mode: "tui",
    abort: () => {
      aborts++;
    },
    ui: {
      notify: (text: string) => notices.push(text),
      setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
      confirm: async () => true,
      select: async () => choices.shift(),
    },
  } as unknown as ExtensionCommandContext;
  return {
    choices,
    credentialState: () => ({ credentialChecks, imports }),
    action: (name: string) => command.handler(name, ctx),
    emit: (name: string, event: unknown = {}) => {
      for (const handler of [...(handlers.get(name) ?? [])]) handler(event);
    },
    ready: () => callbacks.ready(),
    call: (id: string, request: string) => callbacks.call({ id, name: "handoff", args: { request } }),
    interrupted: () => callbacks.interrupted(),
    cancelled: (ids: string[]) => callbacks.cancelled(ids),
    incoming: (pcm: string) => callbacks.audio(pcm),
    capture: (pcm: string) => capture(pcm),
    state: () => ({ keyReads, connects, audioStarts, audioCloses, socketCloses, aborts, interrupts }),
    sent,
    responses,
    played,
    captured,
    statuses,
    notices,
  };
}

test("explicit-start gate and two loops: audio continues while configured agent promise is pending", async () => {
  const f = fixture();
  await f.action("setup");
  expect(f.state()).toMatchObject({ keyReads: 0, connects: 0, audioStarts: 0 });
  await f.action("start");
  expect(f.state()).toMatchObject({ keyReads: 1, connects: 1, audioStarts: 0 });
  f.ready();
  await flush();
  expect(f.state().audioStarts).toBe(1);
  f.call("google-1", "inspect the failing tests");
  expect(f.sent).toEqual([
    {
      text: "[Live request live-1]\ninspect the failing tests",
      options: { deliverAs: "followUp", expandPromptTemplates: false },
    },
  ]);
  f.emit("input", { source: "extension", text: "[Live request live-1]\ninspect the failing tests" });
  f.emit("message_end", { message: { role: "user", content: [{ type: "text", text: "inspect the failing tests" }] } });
  f.emit("turn_start");
  f.emit("tool_execution_start", { toolName: "execute", toolCallId: "t1", args: { secret: "do not relay" } });
  await flush();
  f.capture("AAAA");
  f.incoming("AAAA");
  expect(f.captured).toEqual(["AAAA"]);
  expect(f.played).toEqual(["AAAA"]);
  expect(JSON.stringify(f.responses)).toContain("tool_started");
  expect(JSON.stringify(f.responses)).not.toContain("do not relay");
  f.interrupted();
  expect(f.state()).toMatchObject({ interrupts: 1, aborts: 0 });
  await f.action("stop");
  expect(f.state()).toMatchObject({ audioCloses: 1, socketCloses: 1, aborts: 0 });
  expect(f.statuses.get("die-live")).toBeUndefined();
});

test("Live tool cancellation and session replacement close reporting, not work; explicit cancel is separate", async () => {
  const f = fixture();
  await f.action("start");
  f.ready();
  await flush();
  f.call("google-1", "implement");
  f.cancelled(["google-1"]);
  expect(f.state().aborts).toBe(0);
  await f.action("cancel-work");
  expect(f.state().aborts).toBe(1);
  f.emit("session_start");
  expect(f.state()).toMatchObject({ audioCloses: 1, socketCloses: 1 });
  const before = f.responses.length;
  f.emit("tool_execution_start", { toolName: "execute", toolCallId: "later" });
  await flush();
  expect(f.responses.length).toBe(before);
});

test("nonlocal contexts cannot load keys, connect, or record", async () => {
  const f = fixture(false);
  await f.action("start");
  expect(f.state()).toMatchObject({ keyReads: 0, connects: 0, audioStarts: 0 });
});

test("confirmed background resumption reaches the live channel and completed associations do not fill handoff capacity", async () => {
  const f = fixture();
  await f.action("start");
  f.ready();
  await flush();
  for (let i = 0; i < 12; i++) {
    f.call("google-" + i, "work " + i);
    const text = f.sent.at(-1)!.text;
    f.emit("message_end", { message: { role: "user", content: [{ type: "text", text }] } });
    f.emit("message_end", {
      message: { role: "assistant", content: [{ type: "text", text: "Started a background job; not done yet." }] },
    });
    f.emit("agent_end");
    await flush();
  }
  expect(f.sent).toHaveLength(12);
  expect(JSON.stringify(f.responses)).not.toContain("tracking is full");
  const before = f.responses.length;
  f.emit("message_end", {
    message: { role: "assistant", content: [{ type: "text", text: "Confirmed background result." }] },
  });
  await flush();
  const result = f.responses.slice(before);
  expect(JSON.stringify(result)).toContain("Confirmed background result.");
  expect(JSON.stringify(result)).toContain("current_session");
  expect(result[0]![0]).toBe("google-11");
  expect(result[0]![2]).toBe(true);
  await f.action("stop");
});

test("setup refuses nonlocal contexts and active Live without inspecting credentials", async () => {
  const remote = fixture(false);
  await remote.action("setup");
  expect(remote.credentialState().credentialChecks).toBe(0);
  expect(remote.state().connects).toBe(0);
  const local = fixture();
  await local.action("start");
  await local.action("setup");
  expect(local.credentialState().credentialChecks).toBe(0);
  await local.action("stop");
});

test("wizard paid test never creates audio/bridge and closes on session shutdown", async () => {
  const f = fixture();
  f.choices.push("Test paid connection (no microphone or speakers)");
  const pending = f.action("setup");
  await flush();
  expect(f.state()).toMatchObject({ connects: 1, audioStarts: 0 });
  expect(f.sent).toHaveLength(0);
  f.emit("session_shutdown");
  await pending;
  expect(f.state()).toMatchObject({ socketCloses: 1, audioStarts: 0, aborts: 0 });
  await f.action("setup");
  expect(f.credentialState().credentialChecks).toBe(2);
});
test("wizard explicit start keeps the existing configured agent wiring", async () => {
  const f = fixture();
  f.choices.push("Start Live");
  await f.action("setup");
  expect(f.state()).toMatchObject({ connects: 1, audioStarts: 0 });
  f.ready();
  await flush();
  expect(f.state().audioStarts).toBe(1);
  f.call("wizard-handoff", "inspect a failure");
  expect(f.sent).toHaveLength(1);
  await f.action("stop");
});
