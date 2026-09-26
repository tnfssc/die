import { test, expect } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerQuestions } from "../src/questions/extension";

test("question commands keep status pinned without stealing focus or repeating notices", async () => {
  const hooks = new Map<string, (...args: any[]) => unknown>();
  let command!: { handler: (args: string, ctx: ExtensionContext) => Promise<void> };
  const statuses = new Map<string, string>();
  const notices: string[] = [];
  const questions = [{ id: "q1", question: "Choose a target?", status: "pending" }];
  let changed = () => {};
  const service = {
    subscribe: (callback: () => void) => {
      changed = callback;
      return () => {
        changed = () => {};
      };
    },
    handle: (method: string, params: Record<string, unknown> = {}) => {
      if (method === "questions.list")
        return params.status ? questions.filter((q) => q.status === params.status) : questions;
      if (method === "questions.get") return questions.find((q) => q.id === params.id);
      if (method === "questions.answer" || method === "questions.cancel") {
        const q = questions.find((q) => q.id === params.id)!;
        q.status = method === "questions.answer" ? "answered" : "cancelled";
        changed();
        return q;
      }
      throw Error(method);
    },
  };
  const pi = {
    on: (name: string, callback: (...args: any[]) => unknown) => {
      hooks.set(name, callback);
    },
    registerCommand: (_name: string, value: typeof command) => {
      command = value;
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    ui: {
      setStatus: (name: string, value: string | undefined) =>
        value ? statuses.set(name, value) : statuses.delete(name),
      notify: (text: string) => notices.push(text),
    },
  } as unknown as ExtensionContext;
  registerQuestions(pi, () => service);
  hooks.get("session_start")!({}, ctx);
  await new Promise((r) => setTimeout(r, 0));
  expect(statuses.get("die-questions")).toBe("1 question pending");
  hooks.get("agent_end")!({}, ctx);
  await new Promise((r) => setTimeout(r, 0));
  expect(notices).toEqual([]);
  await command.handler("detail q1", ctx);
  expect(notices.pop()).toContain("Choose a target?");
  await command.handler("list", ctx);
  expect(notices.pop()).toContain("q1");
  await command.handler("answer q1 deploy now", ctx);
  expect(notices.pop()).toBe("Answer saved for q1");
  expect(statuses.get("die-questions")).toBe("1 question · 1 saved");
  hooks.get("session_shutdown")!({}, ctx);
  expect(statuses.has("die-questions")).toBe(false);
});

test("CLI binds the ID without flattening free-text spacing", async () => {
  let command: any;
  let received: any;
  const pi = {
    on: () => {},
    registerCommand: (_name: string, value: any) => {
      command = value;
    },
  };
  const service = {
    handle: (method: string, params: any) => {
      if (method === "questions.answer") received = params;
      return [];
    },
  };
  const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
  registerQuestions(pi as any, () => service);
  await command.handler("answer q_one keep  these   spaces\nnext line", ctx);
  expect(received).toEqual({ id: "q_one", answer: "keep  these   spaces\nnext line" });
});

test("CLI lists actionable short IDs and resolves them without guessing ambiguous prefixes", async () => {
  let command: any;
  const notices: string[] = [];
  const id = "q_12345678-aaaa-bbbb-cccc-111111111111";
  const questions = [{ id, text: "Which target?", status: "pending" }];
  const calls: Array<{ method: string; params: any }> = [];
  const service = {
    handle: (method: string, params: any) => {
      calls.push({ method, params });
      if (method === "questions.list") return questions;
      if (method === "questions.get") return questions.find((q) => q.id === params.id);
      if (method === "questions.answer") return questions[0];
    },
  };
  const ctx = { ui: { notify: (text: string) => notices.push(text), setStatus: () => {} } };
  registerQuestions(
    {
      on: () => {},
      registerCommand: (_name: string, value: any) => {
        command = value;
      },
    } as any,
    () => service,
  );
  await command.handler("list", ctx);
  expect(notices.pop()).toContain("q_12345678 [pending] Which target?");
  await command.handler("answer q_12345678 Playback", ctx);
  expect(calls.find((call) => call.method === "questions.answer")).toEqual({
    method: "questions.answer",
    params: { id, answer: "Playback" },
  });
  questions.push({ id: "q_12345678-other", text: "Another?", status: "pending" });
  await command.handler("list", ctx);
  expect(notices.pop()).toContain(id);
  await command.handler("answer q_12345678 Playback", ctx);
  expect(notices.pop()).toContain("ambiguous");
  expect(calls.at(-1)?.method).toBe("questions.list");
});

test("empty list and failed refresh remain visibly distinct", async () => {
  let command: any;
  let fail = false;
  const statuses: Array<string | undefined> = [];
  const notices: string[] = [];
  const service = {
    handle: () => {
      if (fail) throw Error("Question ledger unavailable");
      return [];
    },
  };
  const ctx = {
    ui: {
      setStatus: (_name: string, text: string | undefined) => statuses.push(text),
      notify: (text: string) => notices.push(text),
    },
  };
  const pi = {
    on: () => {},
    registerCommand: (_name: string, value: any) => {
      command = value;
    },
  };
  const { refresh } = registerQuestions(pi as any, () => service);
  await command.handler("list", ctx as any);
  expect(notices.pop()).toBe("No questions");
  fail = true;
  await refresh();
  expect(statuses.at(-1)).toBe("/questions unavailable");
  await command.handler("list", ctx as any);
  expect(notices.pop()).toBe("Question ledger unavailable");
});

test("corrupt question data has a readable command error", async () => {
  let command: any;
  const notices: string[] = [];
  registerQuestions(
    {
      on() {},
      registerCommand(_name: string, value: any) {
        command = value;
      },
    } as any,
    () => ({
      handle() {
        throw new SyntaxError("JSON Parse error: Unexpected identifier");
      },
    }),
  );
  await command.handler("list", {
    ui: {
      setStatus() {},
      notify(text: string) {
        notices.push(text);
      },
    },
  });
  expect(notices).toEqual(["Could not read saved questions: invalid data. Repair the questions file before retrying."]);
});

test("no-history sessions do not show a passive questions failure", async () => {
  const hooks = new Map<string, any>();
  let command: any;
  const notices: string[] = [];
  const statuses: unknown[] = [];
  registerQuestions(
    {
      on(name: string, fn: any) {
        hooks.set(name, fn);
      },
      registerCommand(_name: string, value: any) {
        command = value;
      },
    } as any,
    () => ({
      handle() {
        throw new Error("Questions require a persistent session file");
      },
    }),
  );
  const ctx = {
    sessionManager: {
      getSessionFile() {
        return undefined;
      },
    },
    ui: {
      setStatus(_name: string, text: unknown) {
        statuses.push(text);
      },
      notify(text: string) {
        notices.push(text);
      },
    },
  };
  hooks.get("session_start")({}, ctx);
  await Bun.sleep(0);
  expect(statuses).toEqual([undefined]);
  await command.handler("list", ctx);
  expect(notices).toEqual(["Questions require a persistent session file"]);
});
