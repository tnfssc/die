import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  initTheme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Spacer, stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { installConversationDensity } from "../src/ui/conversation-density";
import { executeInputPreview, executeOutputPreview } from "../src/ui/execution-previews";

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
function thinking(parts: string[], hidden = false, outputPad = 1): AssistantMessageComponent {
  return new AssistantMessageComponent(
    { role: "assistant", content: parts.map((value) => ({ type: "thinking", thinking: value })) } as never,
    hidden,
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
function handoffTool(message: string): ToolExecutionComponent {
  const component = new ToolExecutionComponent(
    "execute",
    "handoff-call",
    { code: 'await handoff("' + message + '")' },
    { showImages: false },
    {
      renderShell: "self",
      renderCall: (args: { code?: unknown }, theme: any, context: any) =>
        executeInputPreview(args.code, context.expanded, theme, context.state, context.executionStarted),
      renderResult: (result: any, options: { expanded: boolean }, theme: any, context: any) =>
        executeOutputPreview(result, options.expanded, context.isError, theme, undefined, context.state),
    },
    { requestRender() {} } as never,
    "/tmp",
  );
  component.markExecutionStarted();
  component.updateResult({
    content: [{ type: "text", text: "Execution handed off.\n\n" + message }],
    details: { exitCode: 0, handoff: message, backgroundJobs: [], images: [] },
    isError: false,
  });
  return component;
}
function status(type: "task-complete" | "task-attention", label: string, outputPad = 1): CustomMessageComponent {
  return new CustomMessageComponent(
    { role: "custom", customType: type, content: label, display: true } as never,
    () => new Text(label, outputPad, 0),
    undefined,
    outputPad,
  );
}
function custom(label: string, outputPad = 1): CustomMessageComponent {
  return new CustomMessageComponent(
    { role: "custom", customType: "notice", content: label, display: true } as never,
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
  test("gives first and consecutive users one unhighlighted boundary row", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    add(
      chat,
      new UserMessageComponent(
        "first paragraph\n\nsecond paragraph\n\n    const first = 1;\n\n    const second = 2;\n\nending prose",
        undefined,
        2,
      ),
      new Spacer(1), // InteractiveMode inserts this before every non-initial user.
      new UserMessageComponent("next user", undefined, 2),
      assistant("alpha\n\nomega", 2),
    );

    const rendered = chat.render(80);
    const rows = plain(rendered);
    const visible = rows.map((row) => row.trim());
    expect(rendered[0]).toBe("");
    expect(rows[1]).toBe("  first paragraph");
    expect(visible.indexOf("second paragraph")).toBe(visible.indexOf("first paragraph") + 2);
    expect(visible.indexOf("const second = 2;")).toBe(visible.indexOf("const first = 1;") + 2);
    expect(visible.indexOf("ending prose")).toBeGreaterThan(visible.indexOf("const second = 2;") + 1);
    const nextUser = visible.indexOf("next user");
    expect(nextUser).toBe(visible.indexOf("ending prose") + 2);
    expect(rendered[nextUser - 1]).toBe("");
    expect(rendered[nextUser + 1]).toBe("");
    expect(visible.indexOf("alpha")).toBe(nextUser + 2);
    expect(visible.indexOf("omega")).toBe(visible.indexOf("alpha") + 2);
    expect(rows.filter((row) => row.trim() === "next user" || row.trim() === "alpha")).toEqual([
      "  next user",
      "  alpha",
    ]);
  });

  test("uses one plain row at every native user predecessor and successor", () => {
    restores.push(installConversationDensity());
    const pairs: Array<[Component, Component, string, string]> = [
      [assistant("assistant before"), thinking(["thinking after"]), "assistant before", "thinking after"],
      [thinking(["thinking before"]), tool("tool after"), "thinking before", "tool after"],
      [tool("tool before"), custom("custom after"), "tool before", "custom after"],
      [custom("custom before"), assistant("assistant after"), "custom before", "assistant after"],
    ];

    for (const [before, after, beforeText, afterText] of pairs) {
      const chat = new Container();
      add(chat, before, new Spacer(1), new UserMessageComponent("user content"), after);
      const rows = plain(chat.render(80)).map((row) => row.trim());
      const user = rows.indexOf("user content");
      expect(user).toBe(rows.indexOf(beforeText) + 2);
      expect(rows[user - 1]).toBe("");
      expect(rows[user + 1]).toBe("");
      expect(rows.indexOf(afterText)).toBe(user + 2);
    }
  });

  test("keeps internal user Markdown and successor image rows outside plain boundaries", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const imageBearing = tool("image status");
    (imageBearing as unknown as { imageComponents: Component[] }).imageComponents = [
      new Text("attachment preview", 0, 0),
    ];
    add(chat, new UserMessageComponent("paragraph one\n\nparagraph two"), imageBearing);

    const rows = plain(chat.render(80)).map((row) => row.trim());
    const first = rows.indexOf("paragraph one");
    expect(rows[first - 1]).toBe("");
    expect(rows[first + 1]).toBe("");
    expect(rows[first + 2]).toBe("paragraph two");
    expect(rows[first + 3]).toBe("");
    expect(rows[first + 4]).toBe("image status");
    expect(rows[first + 5]).toBe("attachment preview");
  });

  test("does not consume meaningful trailing rows from prior output", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const prior = tool("prior", "prior\n\n");
    prior.setExpanded(true);
    add(chat, prior, new Spacer(1), new UserMessageComponent("user after output"));

    const rows = plain(chat.render(80)).map((row) => row.trim());
    const priorRow = rows.indexOf("prior");
    const userRow = rows.indexOf("user after output");
    // Two rows belong to the expanded output; the final row is the user boundary.
    expect(rows.slice(priorRow + 1, userRow)).toEqual(["", "", ""]);
  });

  test("keeps user boundaries dense through streaming updates and history-style rebuilds", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const user = new UserMessageComponent("stream question", undefined, 3);
    const streaming = new AssistantMessageComponent(undefined, false, undefined, undefined, 3);
    add(chat, user, streaming);
    streaming.updateContent(
      { role: "assistant", content: [{ type: "thinking", thinking: "stream thought" }] } as never,
      true,
    );
    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual(["", "stream question", "", "stream thought"]);

    user.setOutputPad(2);
    expect(plain(user.render(80))).toEqual(["", "  stream question", ""]);

    chat.clear();
    add(
      chat,
      assistant("history answer"),
      new Spacer(1),
      new UserMessageComponent("history question"),
      status("task-complete", "history custom"),
    );
    const rebuilt = plain(chat.render(80)).map((row) => row.trim());
    expect(rebuilt.slice(rebuilt.indexOf("history answer"))).toEqual([
      "history answer",
      "",
      "history question",
      "",
      "history custom",
    ]);
  });

  test("keeps one visible handoff message through invisible tool carriers and density rendering", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const message = "Work is continuing while the background job finishes.";
    const carrier = new AssistantMessageComponent({
      role: "assistant",
      content: [{ type: "toolCall", id: "handoff-call", name: "execute", arguments: { code: "handoff" } }],
    } as never);
    add(chat, carrier, handoffTool(message), thinking(["Waiting for completion"]));

    const rendered = plain(chat.render(36)).join("\n");
    expect(rendered).toContain("Work is continuing");
    expect(rendered.split("Work is continuing")).toHaveLength(2);
    expect(rendered).not.toContain("Execution handed off");
    expect(rendered).not.toContain("executing");
    expect(rendered).toContain("Waiting for completion");
  });

  test("compacts displayed thinking prose gaps while preserving normal answer Markdown", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const phases = new AssistantMessageComponent({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Fixing test-harness isolation" },
        { type: "thinking", thinking: "Securing test-harness probes" },
        { type: "thinking", thinking: "Checking the focused UI case\n\nIntentional thinking paragraph" },
        {
          type: "text",
          text: "Normal answer paragraph\n\nSecond answer paragraph\n\n- first item\n- second item\n\n```ts\nconst value = 1;\n```",
        },
      ],
    } as never);
    add(chat, phases);

    const rows = plain(chat.render(80)).map((row) => row.trimEnd());
    const visible = rows.map((row) => row.trim());
    const fixing = visible.indexOf("Fixing test-harness isolation");
    const securing = visible.indexOf("Securing test-harness probes");
    const checking = visible.indexOf("Checking the focused UI case");
    const thoughtParagraph = visible.indexOf("Intentional thinking paragraph");
    const answer = visible.indexOf("Normal answer paragraph");
    const secondAnswer = visible.indexOf("Second answer paragraph");

    expect(securing).toBe(fixing + 1);
    expect(checking).toBe(securing + 1);
    expect(thoughtParagraph).toBe(checking + 1);
    expect(answer).toBe(thoughtParagraph + 2);
    expect(secondAnswer).toBe(answer + 2);
    expect(visible.indexOf("- first item")).toBe(secondAnswer + 2);
    const secondItem = visible.indexOf("- second item");
    const code = visible.indexOf("const value = 1;");
    expect(secondItem).toBe(secondAnswer + 3);
    expect(code).toBe(secondItem + 3);
  });

  test("compacts Responses-style summaries accumulated in one thinking block while streaming and final", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const source = {
      role: "assistant" as const,
      content: [{ type: "thinking" as const, thinking: "Inspecting provider behavior\n\nApplying the UI fix\n\n" }],
    };
    const phases = new AssistantMessageComponent(source as never);
    add(chat, phases);

    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual([
      "",
      "Inspecting provider behavior",
      "Applying the UI fix",
    ]);
    expect(source.content[0]?.thinking).toBe("Inspecting provider behavior\n\nApplying the UI fix\n\n");

    phases.updateContent(
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Streaming first phase\n\n" }],
      } as never,
      true,
    );
    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual(["", "Streaming first phase"]);

    phases.updateContent(
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Streaming first phase\n\nStreaming second phase" }],
      } as never,
      true,
    );
    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual([
      "",
      "Streaming first phase",
      "Streaming second phase",
    ]);

    phases.updateContent(
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Streaming first phase\n\nStreaming second phase\n\n" }],
      } as never,
      false,
    );
    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual([
      "",
      "Streaming first phase",
      "Streaming second phase",
    ]);
  });

  test("retains thinking blank lines that protect lists and fenced code", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const phases = thinking([
      "First prose phase\n\nSecond prose phase\n\n- first item\n- second item\n\nAfter list\n\n" +
        "```ts\nconst first = 1;\n\nconst second = 2;\n```\n\nAfter code",
    ]);
    add(chat, phases);

    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual([
      "",
      "First prose phase",
      "Second prose phase",
      "",
      "- first item",
      "- second item",
      "",
      "After list",
      "",
      "```ts",
      "const first = 1;",
      "",
      "const second = 2;",
      "```",
      "",
      "After code",
    ]);
  });

  test("preserves Markdown boundaries across separate thinking parts", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    add(chat, thinking(["- First item\n- Second item", "Following prose"]));
    const rows = plain(chat.render(80)).map((row) => row.trim());
    expect(rows.indexOf("Following prose")).toBe(rows.indexOf("- Second item") + 2);
  });

  test("compacts consecutive non-user boundaries except status-to-prose", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const firstPhase = thinking(["Fixing test-harness isolation"]);
    const secondPhase = thinking(["Securing test-harness probes"]);
    add(
      chat,
      assistant("Normal answer before"),
      firstPhase,
      secondPhase,
      tool("tool output"),
      assistant("Normal answer after"),
    );

    expect(plain(chat.render(80))).toEqual([
      "",
      " Normal answer before",
      " Fixing test-harness isolation",
      " Securing test-harness probes",
      " tool output",
      "",
      " Normal answer after",
    ]);
  });

  test("keeps thinking compaction through hide/show, streaming updates, and resize", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const phases = thinking(["Fixing test-harness isolation", "Securing test-harness probes"], true);
    add(chat, phases);

    const collapsedRows = chat.render(80);
    expect(plain(collapsedRows).map((row) => row.trim())).toEqual(["", "Thinking..."]);
    expect(
      phases.handleMouse({
        type: "click",
        button: "left",
        x: 1,
        y: 1,
        screenX: 1,
        screenY: 1,
        width: 80,
        height: collapsedRows.length,
        shift: false,
        alt: false,
        ctrl: false,
      })?.handled,
    ).toBe(true);
    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual([
      "",
      "Fixing test-harness isolation",
      "Securing test-harness probes",
    ]);

    phases.updateContent(
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Updating the streaming density case" },
          { type: "thinking", thinking: "Verifying resize behavior" },
        ],
      } as never,
      true,
    );
    const narrow = plain(chat.render(24)).map((row) => row.trim());
    expect(narrow).toEqual(["", "Updating the streaming", "density case", "Verifying resize", "behavior"]);
    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual([
      "",
      "Updating the streaming density case",
      "Verifying resize behavior",
    ]);
  });

  test("keeps statuses compact through thinking and separates following prose", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    add(
      chat,
      assistant("before"),
      tool("tool one"),
      thinking(["Waiting for workflow completion"]),
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
    expect(rows).toEqual([
      "",
      " before",
      " tool one",
      " Waiting for workflow completion",
      " tool two",
      " complete",
      " attention",
      "",
      " after",
    ]);
  });

  test("separates tool status from prose but not pure thinking", () => {
    restores.push(installConversationDensity());

    const proseChat = new Container();
    add(proseChat, tool("completed tool"), assistant("Visible answer"));
    expect(plain(proseChat.render(80)).map((row) => row.trim())).toEqual(["", "completed tool", "", "Visible answer"]);

    const thinkingChat = new Container();
    add(thinkingChat, tool("completed tool"), thinking(["Checking result"]));
    expect(plain(thinkingChat.render(80)).map((row) => row.trim())).toEqual(["", "completed tool", "Checking result"]);
  });

  test("tracks mixed and streaming assistant transitions after a status", () => {
    restores.push(installConversationDensity());
    const chat = new Container();
    const phases = new AssistantMessageComponent(undefined, false, undefined, undefined, 1);
    add(chat, status("task-complete", "complete"), phases);

    phases.updateContent(
      { role: "assistant", content: [{ type: "thinking", thinking: "Reviewing output" }] } as never,
      true,
    );
    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual(["", "complete", "Reviewing output"]);

    phases.updateContent({ role: "assistant", content: [{ type: "text", text: "Streaming answer" }] } as never, true);
    expect(plain(chat.render(80)).map((row) => row.trim())).toEqual(["", "complete", "", "Streaming answer"]);

    phases.updateContent(
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Final check" },
          { type: "text", text: "Final answer\n\nSecond paragraph" },
        ],
      } as never,
      false,
    );
    const rows = plain(chat.render(80)).map((row) => row.trim());
    expect(rows).toEqual(["", "complete", "Final check", "", "Final answer", "", "Second paragraph"]);
    expect(blankRuns(chat.render(80))).toEqual([1, 1, 1]);
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
    // Only the initial structural row and the expanded tool's internal Markdown gap remain.
    expect(blankRuns(rows)).toEqual([1, 1]);
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
  test("restores the native thinking renderer and original source parts", () => {
    const restore = installConversationDensity();
    const chat = new Container();
    const phases = thinking(["Fixing test-harness isolation", "Securing test-harness probes"]);
    const nativeUpdate = phases.updateContent;
    add(chat, phases);

    expect(phases.updateContent).not.toBe(nativeUpdate);
    expect(blankRuns(phases.render(80))).toEqual([1]);
    restore();
    expect(phases.updateContent).toBe(nativeUpdate);
    expect(blankRuns(phases.render(80))).toEqual([1, 1]);
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

  test("restores user padding and adjacent standalone spacers when detached", () => {
    const restore = installConversationDensity();
    const chat = new Container();
    const spacer = new Spacer(1);
    const nativeSpacerRender = spacer.render;
    const user = new UserMessageComponent("question");
    const nativeUserRender = user.render;
    add(chat, assistant("before"), spacer, user);

    expect(spacer.render(80)).toEqual([]);
    expect(user.render(80)[0]).toBe("");
    expect(user.render(80).at(-1)).toBe("");
    expect(plain(user.render(80))).toEqual(["", " question", ""]);
    chat.removeChild(user);
    expect(spacer.render(80)).toEqual([""]);
    expect(user.render).toBe(nativeUserRender);
    expect(blankRuns(user.render(80))).toEqual([1, 1]);

    restore();
    expect(spacer.render).toBe(nativeSpacerRender);
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
    const firstUserHits: Array<{ y: number; height: number }> = [];
    const firstUser = new UserMessageComponent("copy user one");
    (firstUser as Component).handleMouse = (event) => {
      firstUserHits.push({ y: event.y, height: event.height });
      return { handled: true };
    };
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
    expect(chat.handleMouse({ ...event, y: 4, screenY: 4 })?.handled).toBe(true);
    expect(firstUserHits).toEqual([{ y: 0, height: 1 }]);
    expect(chat.handleMouse({ ...event, y: 6, screenY: 6 })?.handled).toBe(true);
    expect(userHits).toEqual([{ y: 0, height: 1 }]);
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
