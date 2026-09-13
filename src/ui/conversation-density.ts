import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Container,
  Spacer,
  stripTerminalSequences,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

type RenderComponent = Component & {
  render: (width: number) => string[];
  handleMouse: (event: TuiMouseEvent) => TuiMouseEventResult | undefined;
};
type DensityKind = "user" | "non-user";
type BoxShape = { paddingY: number; invalidate: () => void };

function kind(component: Component): DensityKind | undefined {
  if (component instanceof UserMessageComponent) return "user";
  if (
    component instanceof AssistantMessageComponent ||
    component instanceof ToolExecutionComponent ||
    component instanceof CustomMessageComponent
  ) {
    return "non-user";
  }
  return undefined;
}

function userContentBox(component: UserMessageComponent): BoxShape {
  const child = component.children[0];
  if (component.children.length !== 1 || !(child instanceof Box) || !("paddingY" in child)) {
    throw new Error("Pi 0.85 conversation-density seam changed: user content box shape is unsupported");
  }
  return child as unknown as BoxShape;
}

function setUserVerticalPadding(component: UserMessageComponent, padding: number): void {
  const box = userContentBox(component);
  if (box.paddingY === padding) return;
  box.paddingY = padding;
  box.invalidate();
}

function isOneLineSpacer(component: Component | undefined): component is Spacer {
  return component instanceof Spacer && component.render(1).length === 1;
}

type AssistantContent = { type?: unknown; text?: unknown; thinking?: unknown; [key: string]: unknown };
type AssistantMessageShape = { content?: AssistantContent[]; stopReason?: unknown; [key: string]: unknown };
type AssistantShape = RenderComponent & {
  lastMessage?: AssistantMessageShape;
  hasToolCalls?: unknown;
  isStreaming?: boolean;
  updateContent: (message: AssistantMessageShape, isStreaming?: boolean) => void;
};

function isStructuredMarkdownLine(line: string): boolean {
  // Blank lines carry Markdown structure around these block-level constructs.
  // Keep this deliberately conservative rather than flattening all assistant output.
  if (/^(?: {4}|\t)/.test(line)) return true;
  const block = line.replace(/^ {0,3}/, "");
  return (
    /^(?:>|(?:[-+*]|\d+[.)])\s|(?:`{3,}|~{3,})|(?:[-*_]\s*){3,}$|(?:={2,}|-{2,})\s*$|\[[^\]]+\]:|<[/!?A-Za-z]|:{3,}(?:\s|$))/.test(
      block,
    ) || block.includes("|")
  );
}

function fencedMarkdownLines(lines: string[]): boolean[] {
  const fenced = lines.map(() => false);
  let marker: { character: string; length: number } | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (marker) {
      fenced[index] = true;
      const closing = line.match(/^ {0,3}((?:`+)|(?:~+))\s*$/)?.[1];
      if (closing?.startsWith(marker.character) && closing.length >= marker.length) marker = undefined;
      continue;
    }
    const opening = line.match(/^ {0,3}((?:`{3,})|(?:~{3,}))/)?.[1];
    if (opening) {
      fenced[index] = true;
      marker = { character: opening[0] ?? "", length: opening.length };
    }
  }
  return fenced;
}

/**
 * OpenAI Responses accumulates all reasoning summary parts in one thinking
 * string, inserting two newlines after each part. Pi also joins adjacent
 * thinking blocks with two newlines. Compact plain-prose gaps from both paths,
 * but retain blank lines that delimit Markdown block structures or occur in
 * fenced code. The source message is never mutated.
 */
function compactThinkingProse(text: string): string {
  const lines = text.split("\n");
  const fenced = fencedMarkdownLines(lines);
  const compacted: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() !== "") {
      compacted.push(line);
      continue;
    }
    const blankStart = index;
    while (index + 1 < lines.length && lines[index + 1]?.trim() === "") index++;
    const previous = lines[blankStart - 1];
    const next = lines[index + 1];
    const compactPlainProseGap =
      previous !== undefined &&
      next !== undefined &&
      !fenced[blankStart] &&
      !isStructuredMarkdownLine(previous) &&
      !isStructuredMarkdownLine(next);
    if (!compactPlainProseGap) compacted.push(...lines.slice(blankStart, index + 1));
  }
  return compacted.join("\n");
}

function compactThinkingForDisplay(message: AssistantMessageShape): AssistantMessageShape {
  const content = message.content;
  if (!Array.isArray(content)) return message;
  let changed = false;
  const compacted: AssistantContent[] = [];
  for (let index = 0; index < content.length; index++) {
    const part = content[index];
    if (part?.type !== "thinking") {
      compacted.push(part);
      continue;
    }
    const run: AssistantContent[] = [];
    while (index < content.length && content[index]?.type === "thinking") {
      const thinkingPart = content[index];
      if (thinkingPart) run.push(thinkingPart);
      index++;
    }
    index--;
    const visible = run.filter((item) => typeof item.thinking === "string" && item.thinking.trim());
    if (visible.length >= 2) {
      changed = true;
      compacted.push({
        ...visible[0],
        thinking: compactThinkingProse(visible.map((item) => (item.thinking as string).trim()).join("\n\n")),
      });
      continue;
    }
    const only = visible[0];
    if (!only || typeof only.thinking !== "string") {
      compacted.push(...run);
      continue;
    }
    const thinking = compactThinkingProse(only.thinking);
    if (thinking === only.thinking) {
      compacted.push(...run);
    } else {
      changed = true;
      compacted.push({ ...only, thinking });
    }
  }
  return changed ? { ...message, content: compacted } : message;
}

function isInvisibleToolCarrier(component: Component): boolean {
  if (!(component instanceof AssistantMessageComponent)) return false;
  if (!("lastMessage" in component) || !("hasToolCalls" in component)) {
    throw new Error("Pi 0.85 conversation-density seam changed: assistant component shape is unsupported");
  }
  const content = (component as unknown as AssistantShape).lastMessage?.content;
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    !content.some(
      (part) =>
        (part.type === "text" && typeof part.text === "string" && part.text.trim()) ||
        (part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()),
    )
  );
}

function previousComponent(parent: Container, index: number): Component | undefined {
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex--) {
    const previous = parent.children[previousIndex];
    if (!previous) return undefined;
    if ((previous instanceof Spacer && previous.render(1).length === 0) || isInvisibleToolCarrier(previous)) continue;
    return previous;
  }
  return undefined;
}

function previousKind(parent: Container, index: number): DensityKind | undefined {
  const previous = previousComponent(parent, index);
  return previous ? kind(previous) : undefined;
}

function isBlank(line: string): boolean {
  return stripTerminalSequences(line).trim().length === 0;
}

/**
 * Pi 0.85 puts highlighted vertical padding inside each user message and gives
 * every native message ownership of leading transition space. InteractiveMode
 * additionally inserts a standalone one-line spacer before non-initial users,
 * but does not expose a transition-spacing hook on its chat container.
 * Container.addChild is global, so this adapts recognized message instances added
 * to any Container parent; it is not gated to the top-level
 * chat tree. Its assistant update wrapper compacts plain-prose gaps only in
 * displayed thinking (including provider-accumulated summaries and adjacent Pi
 * thinking parts), retaining the source message for streaming and restoration.
 * User Markdown stays inside its native background box with that box's vertical
 * padding replaced by one plain terminal row on each conversation boundary.
 * Structural leading rows are removed between non-user messages. Normal answer
 * Markdown, structured thinking Markdown, expanded tools, images, unrecognized
 * components, and editor layout are otherwise unchanged.
 *
 * Remove this pinned compatibility seam when Pi exposes chat transition
 * spacing. Every patched method and component restoration is identity-checked
 * so wrappers installed later are never clobbered.
 */
export function installConversationDensity(): () => void {
  const seam = [UserMessageComponent, AssistantMessageComponent, ToolExecutionComponent, CustomMessageComponent];
  if (seam.some((componentClass) => !(componentClass.prototype instanceof Container))) {
    throw new Error("Pi 0.85 conversation-density seam changed: native message components are not Containers");
  }
  const prototype = Container.prototype;
  const originalAddChild = prototype.addChild;
  const originalRemoveChild = prototype.removeChild;
  const originalClear = prototype.clear;
  type Restoration = {
    original: (width: number) => string[];
    wrapper: (width: number) => string[];
    reference: WeakRef<RenderComponent>;
    originalMouse: RenderComponent["handleMouse"];
    mouseWrapper: RenderComponent["handleMouse"];
    mouseWidth?: number;
    mouseYOffset: number;
    mouseHeightOffset: number;
    originalUpdate?: AssistantShape["updateContent"];
    updateWrapper?: AssistantShape["updateContent"];
    sourceMessage?: AssistantMessageShape;
    presentedMessage?: AssistantMessageShape;
    isStreaming?: boolean;
  };
  type SpacerRestoration = {
    original: (width: number) => string[];
    wrapper: (width: number) => string[];
    reference: WeakRef<Spacer>;
  };
  const restorations = new WeakMap<RenderComponent, Restoration>();
  const liveReferences = new Set<WeakRef<RenderComponent>>();
  const spacerRestorations = new WeakMap<Spacer, SpacerRestoration>();
  const liveSpacerReferences = new Set<WeakRef<Spacer>>();
  const finalized = new FinalizationRegistry<WeakRef<RenderComponent>>((reference) => {
    liveReferences.delete(reference);
  });
  const finalizedSpacers = new FinalizationRegistry<WeakRef<Spacer>>((reference) => {
    liveSpacerReferences.delete(reference);
  });
  const parentIndexes = new WeakMap<Container, WeakMap<Component, number>>();
  let active = true;

  function rebuildIndexes(parent: Container): void {
    const indexes = new WeakMap<Component, number>();
    for (let index = 0; index < parent.children.length; index++) {
      const child = parent.children[index];
      if (child) indexes.set(child, index);
    }
    parentIndexes.set(parent, indexes);
  }

  function indexAddedChild(parent: Container, component: Component): void {
    const indexes = parentIndexes.get(parent);
    if (indexes) {
      indexes.set(component, parent.children.length - 1);
    } else {
      rebuildIndexes(parent);
    }
  }

  function adaptUserAdjacentSpacer(parent: Container, component: Component | undefined): void {
    if (!isOneLineSpacer(component) || spacerRestorations.has(component)) return;
    const original = component.render;
    const parentReference = new WeakRef(parent);
    function denseSpacer(this: Spacer, width: number): string[] {
      if (!active) return original.call(this, width);
      const owner = parentReference.deref();
      const index = owner?.children.indexOf(this) ?? -1;
      const adjacentToUser =
        index >= 0 &&
        (owner?.children[index - 1] instanceof UserMessageComponent ||
          owner?.children[index + 1] instanceof UserMessageComponent);
      return adjacentToUser ? [] : original.call(this, width);
    }
    const reference = new WeakRef(component);
    const restoration: SpacerRestoration = { original, wrapper: denseSpacer, reference };
    spacerRestorations.set(component, restoration);
    liveSpacerReferences.add(reference);
    finalizedSpacers.register(component, reference, restoration);
    component.render = denseSpacer;
  }

  function restoreSpacer(component: Component): void {
    if (!(component instanceof Spacer)) return;
    const restoration = spacerRestorations.get(component);
    if (!restoration) return;
    if (component.render === restoration.wrapper) component.render = restoration.original;
    spacerRestorations.delete(component);
    liveSpacerReferences.delete(restoration.reference);
    finalizedSpacers.unregister(restoration);
  }

  function restoreComponent(component: Component): void {
    const renderable = component as RenderComponent;
    const restoration = restorations.get(renderable);
    if (!restoration) return;
    if (renderable instanceof UserMessageComponent && userContentBox(renderable).paddingY === 0) {
      setUserVerticalPadding(renderable, 1);
    }
    if (renderable.render === restoration.wrapper) renderable.render = restoration.original;
    if (renderable.handleMouse === restoration.mouseWrapper) renderable.handleMouse = restoration.originalMouse;
    if (restoration.originalUpdate && restoration.updateWrapper) {
      const assistant = renderable as AssistantShape;
      if (assistant.updateContent === restoration.updateWrapper) assistant.updateContent = restoration.originalUpdate;
      if (restoration.sourceMessage) {
        restoration.originalUpdate.call(assistant, restoration.sourceMessage, restoration.isStreaming);
      }
    }
    restorations.delete(renderable);
    liveReferences.delete(restoration.reference);
    finalized.unregister(restoration);
  }

  function denseAddChild(this: Container, component: Component): void {
    originalAddChild.call(this, component);
    if (!active) return;
    indexAddedChild(this, component);
    const index = this.children.length - 1;
    if (component instanceof Spacer) {
      if (this.children[index - 1] instanceof UserMessageComponent) adaptUserAdjacentSpacer(this, component);
      return;
    }
    if (component instanceof UserMessageComponent) {
      adaptUserAdjacentSpacer(this, this.children[index - 1]);
      const box = userContentBox(component);
      if (box.paddingY !== 1) {
        throw new Error("Pi 0.85 conversation-density seam changed: user content box padding is unsupported");
      }
      setUserVerticalPadding(component, 0);
    }
    const componentKind = kind(component);
    if (!componentKind || restorations.has(component as RenderComponent)) return;

    const renderable = component as RenderComponent;
    if (typeof renderable.render !== "function") {
      throw new Error("Pi 0.85 conversation-density seam changed: message component has no render method");
    }
    const originalRender = renderable.render;
    const originalMouse = renderable.handleMouse;
    if (typeof originalMouse !== "function") {
      throw new Error("Pi 0.85 conversation-density seam changed: message component has no mouse handler");
    }
    const assistant =
      renderable instanceof AssistantMessageComponent ? (renderable as unknown as AssistantShape) : undefined;
    if (
      assistant &&
      (!("lastMessage" in assistant) || !("hasToolCalls" in assistant) || typeof assistant.updateContent !== "function")
    ) {
      throw new Error("Pi 0.85 conversation-density seam changed: assistant update shape is unsupported");
    }
    const originalUpdate = assistant?.updateContent;
    const parentReference = new WeakRef(this);
    let restoration: Restoration;
    function denseRender(this: RenderComponent, width: number): string[] {
      if (active && this instanceof UserMessageComponent) setUserVerticalPadding(this, 0);
      const lines = originalRender.call(this, width);
      if (!active) {
        restoration.mouseYOffset = 0;
        restoration.mouseHeightOffset = 0;
        return lines;
      }
      const parent = parentReference.deref();
      const index = parent ? parentIndexes.get(parent)?.get(this) : undefined;
      const precedingKind = parent && index !== undefined ? previousKind(parent, index) : undefined;
      const currentKind = kind(this);
      let rendered = lines;
      let mouseYOffset = 0;
      let mouseHeightOffset = 0;
      if (currentKind === "user") {
        const hasLeadingRow = precedingKind !== "user";
        rendered = hasLeadingRow ? ["", ...lines, ""] : [...lines, ""];
        mouseYOffset = hasLeadingRow ? -1 : 0;
        mouseHeightOffset = hasLeadingRow ? -2 : -1;
      } else if (
        currentKind === "non-user" &&
        precedingKind !== undefined &&
        lines.length >= 2 &&
        isBlank(lines[0] ?? "")
      ) {
        rendered = lines.slice(1);
        mouseYOffset = 1;
        mouseHeightOffset = 1;
      }
      restoration.mouseWidth = width;
      restoration.mouseYOffset = mouseYOffset;
      restoration.mouseHeightOffset = mouseHeightOffset;
      return rendered;
    }
    function denseMouse(this: RenderComponent, event: TuiMouseEvent): TuiMouseEventResult | undefined {
      if (!active || restoration.mouseWidth !== event.width) return originalMouse.call(this, event);
      const { mouseYOffset, mouseHeightOffset } = restoration;
      return originalMouse.call(this, {
        ...event,
        y: event.y + mouseYOffset,
        height: event.height + mouseHeightOffset,
      });
    }
    const reference = new WeakRef(renderable);
    restoration = {
      original: originalRender,
      wrapper: denseRender,
      reference,
      originalMouse,
      mouseWrapper: denseMouse,
      mouseYOffset: 0,
      mouseHeightOffset: 0,
    };
    restorations.set(renderable, restoration);
    liveReferences.add(reference);
    finalized.register(renderable, reference, restoration);
    renderable.render = denseRender;
    renderable.handleMouse = denseMouse;

    if (assistant && originalUpdate) {
      const nativeUpdate = originalUpdate;
      function denseUpdate(this: AssistantShape, message: AssistantMessageShape, isStreaming?: boolean): void {
        const source = message === restoration.presentedMessage ? (restoration.sourceMessage ?? message) : message;
        restoration.sourceMessage = source;
        restoration.isStreaming = isStreaming ?? this.isStreaming;
        const presented = active ? compactThinkingForDisplay(source) : source;
        restoration.presentedMessage = presented;
        if (isStreaming === undefined) nativeUpdate.call(this, presented);
        else nativeUpdate.call(this, presented, isStreaming);
      }
      restoration.originalUpdate = nativeUpdate;
      restoration.updateWrapper = denseUpdate;
      assistant.updateContent = denseUpdate;
      if (assistant.lastMessage) denseUpdate.call(assistant, assistant.lastMessage, assistant.isStreaming);
    }
  }

  function denseRemoveChild(this: Container, component: Component): void {
    originalRemoveChild.call(this, component);
    if (!active) return;
    if (!this.children.includes(component)) {
      restoreComponent(component);
      restoreSpacer(component);
    }
    rebuildIndexes(this);
  }

  function denseClear(this: Container): void {
    if (!active) {
      originalClear.call(this);
      return;
    }
    const removed = [...this.children];
    originalClear.call(this);
    for (const component of removed) {
      restoreComponent(component);
      restoreSpacer(component);
    }
    parentIndexes.delete(this);
  }

  prototype.addChild = denseAddChild;
  prototype.removeChild = denseRemoveChild;
  prototype.clear = denseClear;
  return () => {
    active = false;
    if (prototype.addChild === denseAddChild) prototype.addChild = originalAddChild;
    if (prototype.removeChild === denseRemoveChild) prototype.removeChild = originalRemoveChild;
    if (prototype.clear === denseClear) prototype.clear = originalClear;
    for (const reference of liveReferences) {
      const component = reference.deref();
      if (component) restoreComponent(component);
    }
    liveReferences.clear();
    for (const reference of liveSpacerReferences) {
      const component = reference.deref();
      if (component) restoreSpacer(component);
    }
    liveSpacerReferences.clear();
  };
}
