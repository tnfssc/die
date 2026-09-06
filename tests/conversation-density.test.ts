import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, stripTerminalSequences, type Component } from "@earendil-works/pi-tui";
import { installConversationDensity } from "../src/ui/conversation-density";

beforeAll(() => {
  const packageDir = process.env.PI_PACKAGE_DIR;
  delete process.env.PI_PACKAGE_DIR;
  try {
    initTheme("dark", false);
  } finally {
    if (packageDir !== undefined) process.env.PI_PACKAGE_DIR = packageDir;
  }
});

const restores: Array<() => void> = [];
afterEach(() => {
  while (restores.length) restores.pop()?.();
});

function plain(lines: string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line).trimEnd());
}
function assistant(text: string, outputPad = 1): AssistantMessageComponent {
  return new AssistantMessageComponent(
    { role: "assistant", content: [{ type: "text", text }] } as never,
    false,
    undefined,
    undefined,
    outputPad,
  );
}
function tool(label: string, expandedText?: string): ToolExecutionComponent {
  return new ToolExecutionComponent(
    "execute",
    label,
    {},
    { showImages: false },
    {
      renderShell: "self",
      renderCall: (_args: unknown, _theme: unknown, context: { expanded: boolean }) =>
        new Text(context.expanded && expandedText ? expandedText : label, 1, 0),
    },
    { requestRender() {} } as never,
    "/tmp",
  );
}
function status(type: "task-complete" | "task-attention", label: string, outputPad = 1): CustomMessageComponent {
  return new CustomMessageComponent(
    { role: "custom", customType: type, content: label, display: true } as never,
    () => new Text(label, outputPad, 0),
    undefined,
    outputPad,
  );
}
function add(container: Container, ...components: Component[]): void {
  for (const component of components) container.addChild(component);
}

function blankRuns(lines: string[]): number[] {
  const result: number[] = [];
  let run = 0;
  for (const line of plain(lines)) {
    if (line.trim() === "") run++;
    else if (run) {
      result.push(run);
      run = 0;
    }
  }
  if (run) result.push(run);
  return result;
}

describe("native conversation density adapter", () => {
  test("reduces user/user and user/assistant boundaries to one blank without changing paragraph blanks", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    add(
      chat,
      new UserMessageComponent("first", undefined, 2),
      new UserMessageComponent("second", undefined, 2),
      assistant("alpha\n\nomega", 2),
    );

    const rows = plain(chat.render(80));
    expect(blankRuns(rows)).toEqual([1, 1, 1, 1]);
    expect(
      rows.filter(
        (row) => row.includes("first") || row.includes("second") || row.includes("alpha") || row.includes("omega"),
      ),
    ).toEqual(["  first", "  second", "  alpha", "  omega"]);
  });

  test("keeps prose/tool separators but removes gaps inside collapsed execute/status groups", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    add(
      chat,
      assistant("before"),
      tool("tool one"),
      new AssistantMessageComponent({
        role: "assistant",
        content: [{ type: "toolCall", id: "two", name: "execute", arguments: {} }],
      } as never),
      tool("tool two"),
      status("task-complete", "complete"),
      status("task-attention", "attention"),
      assistant("after"),
    );

    const rows = plain(chat.render(80));
    expect(rows).toEqual(["", " before", "", " tool one", " tool two", " complete", " attention", "", " after"]);
  });

  test("preserves expanded tool content, image-bearing layout, and failure text", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const first = tool("compact");
    const expanded = tool("expanded", "source\n\noutput");
    expanded.setExpanded(true);
    const imageBearing = tool("image status");
    (imageBearing as unknown as { imageComponents: Component[] }).imageComponents = [new Text("image", 0, 0)];
    const failure = tool("✗ Execution failed · exit 1");
    add(chat, first, expanded, imageBearing, failure);

    const rows = plain(chat.render(80));
    expect(rows).toContain(" source");
    expect(rows).toContain("");
    expect(rows).toContain(" output");
    expect(rows).toContain(" ✗ Execution failed · exit 1");
    // None of these transitions qualifies as two adjacent compact text rows.
    expect(blankRuns(rows).length).toBeGreaterThanOrEqual(3);
  });

  test("restores only wrappers it still owns", () => {
    const restore = installConversationDensity();
    const chat = new Container();
    const message = assistant("answer");
    add(chat, new UserMessageComponent("question"), message);
    const foreign = () => ["foreign"];
    const foreignMouse: NonNullable<Component["handleMouse"]> = () => ({ handled: true });
    message.render = foreign;
    (message as Component).handleMouse = foreignMouse;
    restore();
    expect(message.render).toBe(foreign);
    expect((message as Component).handleMouse).toBe(foreignMouse);
  });
  test("untracks removed and cleared components, then rebuilds and reinstalls cleanly", () => {
    const firstRestore = installConversationDensity();
    const chat = new Container();
    const first = new UserMessageComponent("first");
    const second = new UserMessageComponent("second");
    const answer = assistant("answer");
    const firstRender = first.render;
    const secondRender = second.render;
    const answerRender = answer.render;

    add(chat, first, second, answer);
    expect(second.render).not.toBe(secondRender);
    chat.removeChild(second);
    expect(second.render).toBe(secondRender);
    chat.clear();
    expect(first.render).toBe(firstRender);
    expect(answer.render).toBe(answerRender);

    add(chat, first, second, answer);
    expect(plain(chat.render(80)).filter((line) => line.trim())).toEqual([" first", " second", " answer"]);
    firstRestore();
    expect(first.render).toBe(firstRender);
    expect(second.render).toBe(secondRender);
    expect(answer.render).toBe(answerRender);

    const secondRestore = installConversationDensity();
    const rebuilt = new Container();
    add(rebuilt, first, second, answer);
    expect(blankRuns(rebuilt.render(80))).toEqual([1, 1, 1]);
    secondRestore();
  });

  test("preserves a foreign addChild wrapper installed after the density adapter", () => {
    const prototype = Container.prototype;
    const originalAddChild = prototype.addChild;
    const restore = installConversationDensity();
    const densityAddChild = prototype.addChild;
    function foreignAddChild(this: Container, component: Component): void {
      densityAddChild.call(this, component);
    }
    prototype.addChild = foreignAddChild;
    try {
      restore();
      expect(prototype.addChild).toBe(foreignAddChild);
      const chat = new Container();
      chat.addChild(new UserMessageComponent("still works"));
      expect(plain(chat.render(80))).toContain(" still works");
    } finally {
      if (prototype.addChild === foreignAddChild) prototype.addChild = originalAddChild;
      restore();
    }
  });

  test("keeps dense native rows aligned with their original mouse hit areas", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const first = tool("first");
    const toggleHits: Array<{ y: number; height: number }> = [];
    const second = tool("second");
    (second as Component).handleMouse = (event) => {
      toggleHits.push({ y: event.y, height: event.height });
      return { handled: true };
    };
    const firstUser = new UserMessageComponent("copy user one");
    const userHits: Array<{ y: number; height: number }> = [];
    const secondUser = new UserMessageComponent("copy user two");
    (secondUser as Component).handleMouse = (event) => {
      userHits.push({ y: event.y, height: event.height });
      return { handled: true };
    };
    const assistantHits: Array<{ y: number; height: number }> = [];
    const answer = assistant("copy assistant");
    (answer as Component).handleMouse = (event) => {
      assistantHits.push({ y: event.y, height: event.height });
      return { handled: true };
    };
    add(chat, first, second, firstUser, secondUser, answer);

    const rows = chat.render(80);
    expect(plain(rows)).toEqual([
      "",
      " first",
      " second",
      "",
      " copy user one",
      "",
      " copy user two",
      "",
      " copy assistant",
    ]);
    const event = {
      type: "click",
      button: "left",
      x: 1,
      y: 2,
      screenX: 1,
      screenY: 2,
      width: 80,
      height: rows.length,
      shift: false,
      alt: false,
      ctrl: false,
    } as const;
    expect(chat.handleMouse(event)?.handled).toBe(true);
    expect(toggleHits).toEqual([{ y: 1, height: 2 }]);
    expect(chat.handleMouse({ ...event, y: 6, screenY: 6 })?.handled).toBe(true);
    expect(userHits).toEqual([{ y: 1, height: 3 }]);
    expect(chat.handleMouse({ ...event, y: 8, screenY: 8 })?.handled).toBe(true);
    expect(assistantHits).toEqual([{ y: 1, height: 2 }]);
  });
  test("foreign render chains stop applying density after disposal", () => {
    const restore = installConversationDensity();
    const chat = new Container();
    const message = assistant("answer");
    const nativeRender = message.render;
    add(chat, new UserMessageComponent("question"), message);
    const denseRender = message.render;
    const foreign = (width: number) => denseRender.call(message, width);
    message.render = foreign;
    try {
      expect(plain(message.render(80))).toEqual([" answer"]);
      restore();
      expect(message.render).toBe(foreign);
      expect(message.render(80)).toEqual(nativeRender.call(message, 80));
    } finally {
      restore();
    }
  });
});
