import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, type Component } from "@earendil-works/pi-tui";

type RenderComponent = Component & { render: (width: number) => string[] };
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
 * container. Adapt only recognized top-level message instances as they are
 * attached to a Container. This leaves paragraph/output lines, images, editor
 * layout, and every unrelated Container untouched.
 *
 * Remove this pinned compatibility seam when Pi exposes chat transition
 * spacing. Restoration is conditional so a later wrapper is never clobbered.
 */
export function installConversationDensity(): () => void {
  const seam = [UserMessageComponent, AssistantMessageComponent, ToolExecutionComponent, CustomMessageComponent];
  if (seam.some((componentClass) => !(componentClass.prototype instanceof Container))) {
    throw new Error("Pi 0.85 conversation-density seam changed: native message components are not Containers");
  }
  const prototype = Container.prototype;
  const originalAddChild = prototype.addChild;
  const restorations = new Map<
    RenderComponent,
    { original: (width: number) => string[]; wrapper: (width: number) => string[] }
  >();

  function denseAddChild(this: Container, component: Component): void {
    originalAddChild.call(this, component);
    const componentKind = kind(component);
    if (!componentKind || restorations.has(component as RenderComponent)) return;

    const renderable = component as RenderComponent;
    if (typeof renderable.render !== "function") {
      throw new Error("Pi 0.85 conversation-density seam changed: message component has no render method");
    }
    const originalRender = renderable.render;
    const parent = this;
    function denseRender(this: RenderComponent, width: number): string[] {
      const lines = originalRender.call(this, width);
      if (lines.length < 2 || !isBlank(lines[0] ?? "")) return lines;

      const index = parent.children.indexOf(this);
      if (index < 1) return lines;
      const precedingKind = previousKind(parent, index);
      const currentKind = kind(this);
      const collapseUserBoundary = currentKind === "user" && precedingKind === "user";
      const collapseUserAssistantBoundary = currentKind === "assistant" && precedingKind === "user";
      const collapseCompactBoundary =
        currentKind === "compact" && precedingKind === "compact" && lines.length === 2 && !isBlank(lines[1] ?? "");
      return collapseUserBoundary || collapseUserAssistantBoundary || collapseCompactBoundary ? lines.slice(1) : lines;
    }
    restorations.set(renderable, { original: originalRender, wrapper: denseRender });
    renderable.render = denseRender;
  }

  prototype.addChild = denseAddChild;
  return () => {
    if (prototype.addChild === denseAddChild) prototype.addChild = originalAddChild;
    for (const [component, render] of restorations) {
      if (component.render === render.wrapper) component.render = render.original;
    }
    restorations.clear();
  };
}
