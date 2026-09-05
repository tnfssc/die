import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  SelectList,
  fuzzyFilter,
  truncateToWidth,
  type Component,
  type Focusable,
  type SelectItem,
  type KeybindingsManager,
} from "@earendil-works/pi-tui";
import {
  SUBAGENT_TYPES,
  THINKING_LEVELS,
  type Profiles,
  type SubagentType,
  type ThinkingLevel,
} from "../tasks/subagent-profiles";

export interface ProfileModel {
  provider: string;
  id: string;
  name?: string;
}
const INHERIT = "inherit";
type Screen = "profiles" | "model" | "thinking";

/** One panel keeps the selected settings row while entering/leaving a picker. */
export class SubagentSettingsPanel implements Component, Focusable {
  private screen: Screen = "profiles";
  private row = 0;
  private type: SubagentType = "fast";
  private input = new Input({ placeholder: "Search models or providers…" });
  private list!: SelectList;
  private items: SelectItem[] = [];
  private selected = 0;
  private draft: Profiles;
  private models: ProfileModel[];
  private visible = 10;
  private hasFocus = false;
  get focused() {
    return this.hasFocus;
  }
  set focused(value: boolean) {
    this.hasFocus = value;
    this.input.focused = value && this.screen === "model";
  }

  constructor(
    profiles: Profiles,
    models: ProfileModel[],
    private theme: Theme,
    private keys: KeybindingsManager,
    private done: (profiles?: Profiles) => void,
    private changed: () => void,
    private parentModel?: string,
    private parentThinking?: string,
  ) {
    this.draft = structuredClone(profiles);
    this.models = [...new Map(models.map((model) => [model.provider + "/" + model.id, model])).values()].sort((a, b) =>
      (a.provider + "/" + a.id).localeCompare(b.provider + "/" + b.id),
    );
    this.rebuild();
  }
  private rebuild() {
    if (this.screen === "profiles") {
      this.items = SUBAGENT_TYPES.flatMap((type) => [
        {
          value: type + ":model",
          label: type + " model",
          description: this.draft[type].model ?? "Inherit from parent",
        },
        {
          value: type + ":thinking",
          label: type + " thinking",
          description: this.draft[type].thinking ?? "Inherit from parent",
        },
      ]).concat([
        { value: "save", label: "Save", description: "Apply to future sub-agents" },
        { value: "cancel", label: "Cancel", description: "Discard changes" },
      ]);
      this.selected = this.row;
    } else if (this.screen === "thinking") {
      this.items = [
        {
          value: INHERIT,
          label: "Inherit from parent",
          description: this.parentThinking ?? "Calling agent's thinking level",
        },
        ...THINKING_LEVELS.map((value) => ({ value, label: value, description: "" })),
      ];
    } else {
      const current = this.draft[this.type].model;
      const models: SelectItem[] = this.models.map((model) => ({
        value: model.provider + "/" + model.id,
        label: model.id,
        description: model.provider + (model.name && model.name !== model.id ? " · " + model.name : ""),
      }));
      if (current && !models.some((model) => model.value === current))
        models.unshift({
          value: current,
          label: current,
          description: "Current setting · unavailable in this catalog",
        });
      const all = [
        { value: INHERIT, label: "Inherit from parent", description: this.parentModel ?? "Calling agent's model" },
        ...models,
      ];
      // Provider-first search avoids matching a model suffix against a later provider name.
      const query = this.input.getValue();
      this.items = fuzzyFilter(all, query, (item) => item.value + " " + item.description + " " + item.label);
      const exact = query.trim().toLowerCase().replace(/\s+/g, "/");
      this.items.sort(
        (a, b) =>
          Number(b.value.toLowerCase() === exact || b.label.toLowerCase() === exact) -
          Number(a.value.toLowerCase() === exact || a.label.toLowerCase() === exact),
      );
    }
    this.selected = Math.max(0, Math.min(this.selected, this.items.length - 1));
    this.list = new SelectList(this.items, this.visible, {
      selectedPrefix: (t) => this.theme.fg("accent", t),
      selectedText: (t) => this.theme.fg("accent", t),
      description: (t) => this.theme.fg("muted", t),
      scrollInfo: (t) => this.theme.fg("dim", t),
      noMatch: (t) => this.theme.fg("warning", t),
    });
    this.list.setSelectedIndex(this.selected);
    this.input.focused = this.hasFocus && this.screen === "model";
  }
  private back() {
    this.screen = "profiles";
    this.input.setValue("");
    this.rebuild();
  }
  private choose() {
    const item = this.items[this.selected];
    if (!item) return;
    if (this.screen === "profiles") {
      if (item.value === "save") {
        this.done(this.draft);
        return;
      }
      if (item.value === "cancel") {
        this.done();
        return;
      }
      this.row = this.selected;
      const [type, field] = item.value.split(":");
      this.type = type as SubagentType;
      this.screen = field as "model" | "thinking";
      this.selected = 0;
      this.rebuild();
      const value = this.draft[this.type][this.screen] ?? INHERIT;
      this.selected = Math.max(
        0,
        this.items.findIndex((item) => item.value === value),
      );
      this.list.setSelectedIndex(this.selected);
    } else {
      if (this.screen === "model") {
        if (item.value === INHERIT) delete this.draft[this.type].model;
        else this.draft[this.type].model = item.value;
      } else {
        if (item.value === INHERIT) delete this.draft[this.type].thinking;
        else this.draft[this.type].thinking = item.value as ThinkingLevel;
      }
      this.back();
    }
  }
  handleInput(data: string) {
    if (this.keys.matches(data, "tui.select.cancel")) {
      if (this.screen === "profiles") this.done();
      else this.back();
    } else if (this.keys.matches(data, "tui.select.confirm")) this.choose();
    else {
      let move = 0;
      if (this.keys.matches(data, "tui.select.up")) move = -1;
      else if (this.keys.matches(data, "tui.select.down")) move = 1;
      else if (this.keys.matches(data, "tui.select.pageUp")) move = -this.visible;
      else if (this.keys.matches(data, "tui.select.pageDown")) move = this.visible;
      if (move) {
        this.selected = Math.max(0, Math.min(this.items.length - 1, this.selected + move));
        if (this.screen === "profiles") this.row = this.selected;
        this.list.setSelectedIndex(this.selected);
      } else if (this.screen === "model") {
        const before = this.input.getValue();
        this.input.handleInput(data);
        if (before !== this.input.getValue()) {
          this.selected = 0;
          this.rebuild();
        }
      }
    }
    this.changed();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const title = this.screen === "profiles" ? "Sub-agent profiles" : this.type + " · " + this.screen;
    const selected = this.items[this.selected];
    const help =
      this.screen === "profiles"
        ? "↑↓ navigate · Enter edit/select · Esc discard"
        : "↑↓ navigate · Enter select · Esc back";
    return [
      this.theme.fg("accent", "─".repeat(width)),
      this.theme.fg("accent", title),
      "",
      ...(this.screen === "model" ? [...this.input.render(width), ""] : []),
      ...this.list.render(width),
      "",
      ...(this.screen === "model" && !this.models.length
        ? ["No configured models. Use /login or configure providers."]
        : []),
      ...(selected && this.screen === "model"
        ? [selected.value === INHERIT ? "Inherit from parent" : selected.value]
        : []),
      this.theme.fg("dim", help),
      this.theme.fg("accent", "─".repeat(width)),
    ].map((line) => truncateToWidth(line, width));
  }
  invalidate() {
    this.input.invalidate();
    this.list.invalidate();
  }
}
