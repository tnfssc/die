import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { registerSubagentSettings } from "../src/tasks/subagent-settings-ui";
import { SubagentSettingsPanel } from "../src/ui/subagent-settings";
import { loadProfiles, parseProfiles, type Profiles } from "../src/tasks/subagent-profiles";

const DOWN = "\x1b[B",
  UP = "\x1b[A",
  ENTER = "\r",
  ESC = "\x1b";
const theme = { fg: (_color: string, text: string) => text };
const models = [
  { provider: "alpha", id: "quick", name: "Quick model" },
  { provider: "beta", id: "coder", name: "Implementation" },
];
function panel(profiles = parseProfiles({}), available = models) {
  let result: Profiles | undefined;
  let closed = false;
  const component = new SubagentSettingsPanel(
    profiles,
    available,
    theme as any,
    getKeybindings(),
    (value) => {
      result = value;
      closed = true;
    },
    () => {},
    "parent/model",
    "medium",
  );
  const send = (...keys: string[]) => keys.forEach((key) => component.handleInput(key));
  return { component, send, result: () => result, closed: () => closed };
}
test("fuzzy model/provider search, independent settings and selection preservation", () => {
  const ui = panel();
  ui.send(ENTER, "beta cod", ENTER); // fast model, search, select
  expect(ui.component.render(100).join("\n")).toContain("beta/coder");
  ui.send(DOWN, ENTER, DOWN, ENTER); // fast thinking -> off
  // Returning to fast thinking retains row 1; next row is normal model.
  ui.send(DOWN, ENTER, "alpha", ENTER);
  ui.send(DOWN, DOWN, DOWN, DOWN, ENTER); // row 2 -> Save
  expect(ui.result()).toEqual({
    fast: { model: "beta/coder", thinking: "off" },
    normal: { model: "alpha/quick" },
    orchestrator: {},
  });
});
test("escape from picker returns to the same row; escape from overview discards", () => {
  const original = parseProfiles({ normal: { model: "beta/coder" } });
  const ui = panel(original);
  ui.send(DOWN, DOWN, ENTER, "alpha", ENTER, ENTER); // normal model, edit, reopen
  expect(ui.component.render(100).join("\n")).toContain("normal · model");
  ui.send(ESC, ESC);
  expect(ui.closed()).toBe(true);
  expect(ui.result()).toBeUndefined();
  expect(original.normal.model).toBe("beta/coder");
});
test("inherit resets model and thinking without manual IDs", () => {
  const ui = panel(parseProfiles({ fast: { model: "alpha/quick", thinking: "high" } }));
  ui.send(ENTER, UP, ENTER, DOWN, ENTER, ...Array(5).fill(UP), ENTER, ...Array(5).fill(DOWN), ENTER);
  expect(ui.result()?.fast).toEqual({});
});
test("empty search results cannot select; empty catalog still supports inheritance", () => {
  const ui = panel(parseProfiles({}), []);
  ui.send(ENTER, "missing", ENTER);
  expect(ui.closed()).toBe(false);
  expect(ui.component.render(90).join("\n")).toContain("No configured models");
  ui.send("\x15", ENTER); // clear query then inherit
  expect(ui.component.render(90).join("\n")).toContain("Sub-agent profiles");
});
test("unavailable configured model remains visible and can be retained", () => {
  const ui = panel(parseProfiles({ fast: { model: "custom/missing" } }));
  ui.send(ENTER);
  expect(ui.component.render(120).join("\n")).toContain("unavailable");
  ui.send(ENTER, ...Array(6).fill(DOWN), ENTER);
  expect(ui.result()?.fast.model).toBe("custom/missing");
});
test("narrow rendering stays within width and model input receives focus", () => {
  const ui = panel();
  ui.component.focused = true;
  ui.send(ENTER);
  for (const width of [1, 10, 30, 80])
    for (const line of ui.component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  expect(ui.component.focused).toBe(true);
  expect(ui.component.render(0)).toEqual([]);
});
async function fixture(run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "die-profile-ui-"));
  try {
    await run(join(dir, "subagents.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function command(path: string, action: (component: SubagentSettingsPanel) => void) {
  let handler: any;
  const notices: Array<[string, string]> = [];
  registerSubagentSettings(
    {
      registerCommand(_name: string, definition: any) {
        handler = definition.handler;
      },
    } as any,
    path,
  );
  return {
    notices,
    run: (mode = "tui") =>
      handler("", {
        mode,
        modelRegistry: { getAvailable: () => models },
        ui: {
          custom: async (factory: any) => {
            let result: any;
            const component = factory(
              { requestRender() {} },
              theme,
              getKeybindings(),
              (value: any) => (result = value),
            );
            action(component);
            return result;
          },
          notify: (message: string, kind: string) => notices.push([message, kind]),
        },
      }),
  };
}
test("command persists only on Save", () =>
  fixture(async (path) => {
    const dialog = command(path, (component) =>
      [ENTER, "beta", ENTER, ...Array(6).fill(DOWN), ENTER].forEach((key) => component.handleInput(key)),
    );
    await dialog.run();
    expect((await loadProfiles(path)).fast.model).toBe("beta/coder");
    expect(dialog.notices[0]?.[0]).toContain("Saved");
    const before = await readFile(path, "utf8");
    await command(path, (c) => c.handleInput(ESC)).run();
    expect(await readFile(path, "utf8")).toBe(before);
  }));
test("malformed settings are reported and never overwritten", () =>
  fixture(async (path) => {
    await writeFile(path, "{");
    const dialog = command(path, () => {
      throw new Error("Should not prompt");
    });
    await dialog.run();
    expect(dialog.notices[0]?.[1]).toBe("error");
    expect(await readFile(path, "utf8")).toBe("{");
  }));
test("non-TUI gives file guidance without prompting", () =>
  fixture(async (path) => {
    const dialog = command(path, () => {
      throw new Error("Should not prompt");
    });
    await dialog.run("print");
    expect(dialog.notices[0]?.[0]).toContain(path);
    expect(await Bun.file(path).exists()).toBe(false);
  }));

test("provider/model search prefers the exact model over a shorter prefix", () => {
  const ui = panel(parseProfiles({}), [
    { provider: "openai", id: "gpt-4", name: "GPT-4" },
    { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
  ]);
  ui.send(ENTER, ..."openai gpt-4o", ENTER, ...Array(6).fill(DOWN), ENTER);
  expect(ui.result()?.fast.model).toBe("openai/gpt-4o");
});
