import { describe, expect, test } from "bun:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, type EditorTheme, type TUI, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { CompactEditor, IDLE_PROMPT_ICON } from "../src/ui/editor";

const identity = (text: string) => text;
const theme: EditorTheme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};
function editor() {
  return new CompactEditor(
    { terminal: { rows: 24 }, requestRender() {} } as unknown as TUI,
    theme,
    {
      matches: (data: string, action: string) =>
        (action === "app.interrupt" && data === "\x1b") || (action === "app.exit" && data === "\x04"),
    } as KeybindingsManager,
    { paddingX: 0, embedWorkingStatus: true },
  );
}
const text = (lines: string[]) => lines.map((line) => Bun.stripANSI(line).trimEnd());
const click = (x: number, y: number): TuiMouseEvent =>
  ({ type: "click", button: "left", x, y, width: 40, height: 1 }) as TuiMouseEvent;

describe("borderless editor", () => {
  test("idle chevron shares a stable gutter with the cursor and input", () => {
    const input = editor();
    input.focused = true;
    expect(input.render(80)).toHaveLength(1);
    expect(input.render(80)[0]).toContain(CURSOR_MARKER);
    expect(text(input.render(80))).toEqual([IDLE_PROMPT_ICON]);
    input.handleInput("hello");
    expect(text(input.render(80))).toEqual([IDLE_PROMPT_ICON + " hello"]);
    for (const width of [1, 2, 3, 10, 40, 80]) {
      for (const line of input.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    expect(text(input.render(2))[0]).not.toContain(IDLE_PROMPT_ICON);
    expect(text(input.render(3))[0]).toStartWith(IDLE_PROMPT_ICON + " ");
    let submitted = "";
    input.onSubmit = (value) => {
      submitted = value;
    };
    input.handleInput("\r");
    expect(submitted).toBe("hello");
  });

  test("multiline, wrapping, Unicode and scroll indicators", () => {
    const input = editor();
    input.setText("first\nsecond");
    expect(text(input.render(40))).toEqual([IDLE_PROMPT_ICON + " first", "  second"]);
    input.setText("项目 😀 a long prompt that wraps");
    expect(input.render(12).length).toBeGreaterThan(1);
    for (const line of input.render(12)) expect(visibleWidth(line)).toBeLessThanOrEqual(12);
    input.setText(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
    expect(input.render(40)).toHaveLength(7);
    expect(text(input.render(40))[0]).toStartWith("↑ ");
    expect(text(input.render(40))[0]).not.toContain(IDLE_PROMPT_ICON);
    for (let line = 0; line < 20; line++) input.handleInput("\x1b[A");
    const scrolledToStart = text(input.render(40));
    expect(scrolledToStart[0]).toStartWith(IDLE_PROMPT_ICON + " ");
    expect(scrolledToStart.at(-1)).toStartWith("↓ ");
  });

  test("native app shortcuts, paste, and history remain functional", () => {
    const input = editor();
    let escaped = false,
      exited = false;
    input.onEscape = () => {
      escaped = true;
    };
    input.onCtrlD = () => {
      exited = true;
    };
    input.handleInput("\x1b");
    input.handleInput("\x04");
    expect(escaped).toBe(true);
    expect(exited).toBe(true);
    input.handleInput("\x1b[200~pasted\ntext\x1b[201~");
    expect(input.getText()).toBe("pasted\ntext");
    input.setText("");
    input.addToHistory("previous prompt");
    input.handleInput("\x1b[A");
    expect(input.getText()).toBe("previous prompt");
  });

  test("spinner replaces the chevron without moving input or adding rows", () => {
    const input = editor();
    input.setWorkingStatusIndicator({ renderSpinnerInBorder: () => "*" } as unknown as Parameters<
      CompactEditor["setWorkingStatusIndicator"]
    >[0]);
    expect(text(input.render(80))).toEqual(["*"]);
    expect(text(input.render(80))[0]).not.toContain(IDLE_PROMPT_ICON);
    input.setWorkingStatusIndicator(undefined);
    expect(text(input.render(80))).toEqual([IDLE_PROMPT_ICON]);
    input.setText("draft");
    const idle = text(input.render(80))[0];
    expect(idle).toBe(IDLE_PROMPT_ICON + " draft");
    input.setWorkingStatusIndicator({ renderSpinnerInBorder: () => "*" } as unknown as Parameters<
      CompactEditor["setWorkingStatusIndicator"]
    >[0]);
    const working = text(input.render(80))[0];
    expect(working).toBe("* draft");
    expect(working).not.toContain(IDLE_PROMPT_ICON);
    expect(working.indexOf("draft")).toBe(idle.indexOf("draft"));
    input.setWorkingStatusIndicator(undefined);
    expect(text(input.render(80))).toEqual([IDLE_PROMPT_ICON + " draft"]);
  });

  test("mouse coordinates account for the gutter and removed borders", () => {
    const input = editor();
    input.setText("abcd");
    input.render(40);
    input.handleMouse(click(3, 0));
    input.handleInput("X");
    expect(input.getText()).toBe("aXbcd");

    const narrow = editor();
    narrow.setText("ab");
    narrow.render(3);
    narrow.handleMouse({ ...click(2, 0), width: 3 });
    narrow.handleInput("X");
    expect(narrow.getText()).toBe("Xab");
  });

  test("autocomplete rows survive, select with keyboard and mouse", async () => {
    const input = editor();
    input.setAutocompleteProvider({
      getSuggestions: async () => ({
        prefix: "/",
        items: [
          { value: "/status", label: "/status", description: "Toggle details" },
          { value: "/settings", label: "/settings" },
        ],
      }),
      applyCompletion: (_lines, _line, _col, item) => ({
        lines: [item.value],
        cursorLine: 0,
        cursorCol: item.value.length,
      }),
    });
    input.handleInput("/");
    await Bun.sleep(30);
    expect(input.isShowingAutocomplete()).toBe(true);
    const lines = text(input.render(40));
    expect(lines[0]).toStartWith(IDLE_PROMPT_ICON + " /");
    expect(
      lines
        .filter((line) => line.includes("/status") || line.includes("/settings"))
        .every((line) => line.startsWith("  ")),
    ).toBe(true);
    expect(lines.some((line) => line.includes("/status"))).toBe(true);
    expect(lines.some((line) => line.includes("/settings"))).toBe(true);
    expect(lines.some((line) => line.includes("──"))).toBe(false);
    input.handleMouse(click(4, 2));
    input.handleInput("\t");
    expect(input.getText()).toBe("/settings");
  });
});
