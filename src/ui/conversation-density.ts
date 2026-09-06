import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  stripTerminalSequences,
  type Component,
  type TuiMouseEventResult,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";

type RenderComponent = Component & {
  render: (width: number) => string[];
  handleMouse: (event: TuiMouseEvent) => TuiMouseEventResult | undefined;
};
type DensityKind = "user" | "assistant" | "compact";

type ToolShape = RenderComponent & {
  toolName?: unknown;
  expanded?: unknown;
  imageComponents?: unknown;
  result?: { content?: Array<{ type?: unknown }> };
};
type CustomShape = RenderComponent & {
  message?: { role?: unknown; customType?: unknown };
  _expanded?: unknown;
};

function kind(component: Component): DensityKind | undefined {
  if (component instanceof UserMessageComponent) return "user";
  if (component instanceof AssistantMessageComponent) return "assistant";
  if (component instanceof ToolExecutionComponent) {
    const tool = component as unknown as ToolShape;
    if (!("toolName" in tool) || !("expanded" in tool) || !Array.isArray(tool.imageComponents)) {
      throw new Error("Pi 0.85 conversation-density seam changed: execute component shape is unsupported");
    }
    return tool.toolName === "execute" &&
      tool.expanded === false &&
      Array.isArray(tool.imageComponents) &&
      tool.imageComponents.length === 0 &&
      !tool.result?.content?.some((part) => part.type === "image")
      ? "compact"
      : undefined;
  }
  if (!(component instanceof CustomMessageComponent)) return undefined;
  const custom = component as unknown as CustomShape;
  if (!("message" in custom) || !("_expanded" in custom)) {
    throw new Error("Pi 0.85 conversation-density seam changed: custom message shape is unsupported");
  }
  const customType = custom.message?.customType;
  return custom.message?.role === "custom" &&
    (customType === "task-complete" || customType === "task-attention") &&
    custom._expanded === false
    ? "compact"
    : undefined;
}

type AssistantShape = RenderComponent & {
  lastMessage?: { content?: Array<{ type?: unknown; text?: unknown; thinking?: unknown }> };
};

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

function previousKind(parent: Container, index: number): DensityKind | undefined {
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex--) {
    const previous = parent.children[previousIndex];
    if (!previous) return undefined;
    if (isInvisibleToolCarrier(previous)) continue;
    return kind(previous);
  }
  return undefined;
}

function isBlank(line: string): boolean {
  return stripTerminalSequences(line).trim().length === 0;
}

/**
 * Pi 0.85 gives each native message component ownership of its leading space,
 * but does not expose a transition-spacing hook on InteractiveMode's chat
 * container. Container.addChild is global, so this adapts recognized message
 * instances added to any Container parent; it is not gated to the top-level
 * chat tree. Unrecognized components, paragraph/output lines, images, and
 * editor layout are unchanged.
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
    collapsedWidth?: number;
    collapsed: boolean;
  };
  const restorations = new WeakMap<RenderComponent, Restoration>();
  const liveReferences = new Set<WeakRef<RenderComponent>>();
  const finalized = new FinalizationRegistry<WeakRef<RenderComponent>>((reference) => {
    liveReferences.delete(reference);
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

  function restoreComponent(component: Component): void {
    const renderable = component as RenderComponent;
    const restoration = restorations.get(renderable);
    if (!restoration) return;
    if (renderable.render === restoration.wrapper) renderable.render = restoration.original;
    if (renderable.handleMouse === restoration.mouseWrapper) renderable.handleMouse = restoration.originalMouse;
    restorations.delete(renderable);
    liveReferences.delete(restoration.reference);
    finalized.unregister(restoration);
  }

  function denseAddChild(this: Container, component: Component): void {
    originalAddChild.call(this, component);
    if (!active) return;
    indexAddedChild(this, component);
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
    const parentReference = new WeakRef(this);
    let restoration: Restoration;
    function denseRender(this: RenderComponent, width: number): string[] {
      const lines = originalRender.call(this, width);
      if (!active) {
        restoration.collapsed = false;
        return lines;
      }
      const parent = parentReference.deref();
      const index = parent ? parentIndexes.get(parent)?.get(this) : undefined;
      let collapsed = false;
      if (lines.length >= 2 && isBlank(lines[0] ?? "") && parent && index !== undefined && index >= 1) {
        const precedingKind = previousKind(parent, index);
        const currentKind = kind(this);
        const collapseUserBoundary = currentKind === "user" && precedingKind === "user";
        const collapseUserAssistantBoundary = currentKind === "assistant" && precedingKind === "user";
        const collapseCompactBoundary =
          currentKind === "compact" && precedingKind === "compact" && lines.length === 2 && !isBlank(lines[1] ?? "");
        collapsed = collapseUserBoundary || collapseUserAssistantBoundary || collapseCompactBoundary;
      }
      restoration.collapsedWidth = width;
      restoration.collapsed = collapsed;
      return collapsed ? lines.slice(1) : lines;
    }
    function denseMouse(this: RenderComponent, event: TuiMouseEvent): TuiMouseEventResult | undefined {
      const offset = active && restoration.collapsedWidth === event.width && restoration.collapsed ? 1 : 0;
      return originalMouse.call(
        this,
        offset ? { ...event, y: event.y + offset, height: event.height + offset } : event,
      );
    }
    const reference = new WeakRef(renderable);
    restoration = {
      original: originalRender,
      wrapper: denseRender,
      reference,
      originalMouse,
      mouseWrapper: denseMouse,
      collapsed: false,
    };
    restorations.set(renderable, restoration);
    liveReferences.add(reference);
    finalized.register(renderable, reference, restoration);
    renderable.render = denseRender;
    renderable.handleMouse = denseMouse;
  }

  function denseRemoveChild(this: Container, component: Component): void {
    originalRemoveChild.call(this, component);
    if (!active) return;
    if (!this.children.includes(component)) restoreComponent(component);
    rebuildIndexes(this);
  }

  function denseClear(this: Container): void {
    if (!active) {
      originalClear.call(this);
      return;
    }
    const removed = [...this.children];
    originalClear.call(this);
    for (const component of removed) restoreComponent(component);
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
  };
}
