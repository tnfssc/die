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
