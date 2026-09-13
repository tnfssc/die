import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  getModel,
} from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { GoalStore } from "./goals/store";
import { dieSystemPrompt, type MainAgentMode } from "./prompts";
import asynchronousTasksExtension from "./tasks/extension";

export const PREVIEW_ROLES = ["root", "fast", "normal", "orchestrator"] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

export interface PromptPreviewOptions {
  /** Project context is excluded unless a project directory is selected explicitly. */
  project?: string;
  role?: PreviewRole;
  rootMode?: MainAgentMode;
  message?: string;
  /** Add a representative paused goal so the real context hook exposes its injected message. */
  goal?: string;
}

export interface PromptPreview {
  preview: {
    context: "isolated" | "selected-project";
    label: string;
    cwd: string;
    transientSession: true;
    included: string[];
    excluded: string[];
    role: PreviewRole;
    rootMode?: MainAgentMode;
    networkRequests: 0;
  };
  model: { provider: string; id: string };
  systemPrompt: string;
  tools: NonNullable<Context["tools"]>;
  messages: Context["messages"];
}

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the exact Context passed across Pi's provider stream boundary.
 * The stream is replaced before prompting, so this cannot make a model request.
 */
export async function createPromptPreview(options: PromptPreviewOptions = {}): Promise<PromptPreview> {
  const role = options.role ?? "root";
  if (!PREVIEW_ROLES.includes(role)) throw new Error(`Invalid preview role: ${role}`);
  const rootMode = options.rootMode ?? "orchestrator";
  if (!["fast", "normal", "orchestrator"].includes(rootMode)) throw new Error(`Invalid root mode: ${rootMode}`);
  if (role !== "root" && options.rootMode !== undefined) throw new Error("rootMode applies only to the root role");

  const scratch = await mkdtemp(join(tmpdir(), "die-prompt-preview-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const selectedProject = options.project ? resolve(options.project) : undefined;
    const cwd = selectedProject ?? join(scratch, "project");
    if (!selectedProject) await Bun.write(join(cwd, ".keep"), "");
    else if (!(await exists(cwd))) throw new Error(`Selected project does not exist: ${cwd}`);
    const agentDir = join(scratch, "agent");
    await Bun.write(join(agentDir, ".keep"), "");

    const manager = SessionManager.inMemory(cwd);
    if (role === "root") {
      if (rootMode !== "orchestrator") manager.appendCustomEntry("die-instruction-mode", { mode: rootMode });
    } else manager.appendCustomEntry("die-agent", { type: role, depth: 1 });

    if (options.goal) {
      const goals = new GoalStore((type, data) => manager.appendCustomEntry(type, data));
      goals.set({
        objective: options.goal,
        criteria: ["Preview the injected goal state"],
        constraints: ["Offline preview only"],
      });
      goals.update({ status: "paused", reason: "Representative prompt preview" });
    }

    const projectSystemPath = join(cwd, ".die", "SYSTEM.md");
    const projectSystemSelected = !!selectedProject && (await exists(projectSystemPath));
    const selectedSystemPrompt = projectSystemSelected ? await readFile(projectSystemPath, "utf8") : dieSystemPrompt();
    // The preview role is explicit and must not inherit the caller's own child
    // environment (for example when this script is launched from execute). The
    // production extension reads identity synchronously when its factory runs.
    const previewExtension: typeof asynchronousTasksExtension = (pi, extensionOptions) => {
      const priorDepth = process.env.DIE_SUBAGENT_DEPTH;
      const priorType = process.env.DIE_SUBAGENT_TYPE;
      process.env.DIE_SUBAGENT_DEPTH = role === "root" ? "0" : "1";
      if (role === "root") delete process.env.DIE_SUBAGENT_TYPE;
      else process.env.DIE_SUBAGENT_TYPE = role;
      try {
        asynchronousTasksExtension(pi, extensionOptions);
      } finally {
        if (priorDepth === undefined) delete process.env.DIE_SUBAGENT_DEPTH;
        else process.env.DIE_SUBAGENT_DEPTH = priorDepth;
        if (priorType === undefined) delete process.env.DIE_SUBAGENT_TYPE;
        else process.env.DIE_SUBAGENT_TYPE = priorType;
      }
    };
    // Empty in-memory settings prevent project package resolution/configuration
    // from doing work during an otherwise read-only offline preview.
    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
    const appendPath = join(cwd, ".die", "APPEND_SYSTEM.md");
    const appendSelected = !!selectedProject && (await exists(appendPath));
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noContextFiles: !selectedProject,
      appendSystemPrompt: appendSelected ? [appendPath] : [],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: selectedSystemPrompt,
      extensionFactories: [{ name: "die-tasks", factory: previewExtension }],
    });
    await loader.reload();

    const runtime = await ModelRuntime.create({
      authPath: join(scratch, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    // Authentication preflight is local. The stream replacement below is the
    // hard network boundary and is installed before the first prompt.
    runtime.hasConfiguredAuth = () => true;
    const model = getModel("openai-codex", "gpt-5.6-luna");
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      settingsManager,
      modelRuntime: runtime,
      model,
      sessionManager: manager,
      tools: ["execute"],
    }));

    let captured: Context | undefined;
    let streamCalls = 0;
    session.agent.streamFunction = ((_model: unknown, context: Context) => {
      streamCalls++;
      captured = context;
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "offline prompt preview captured" }],
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-5.6-luna",
        usage,
        stopReason: "stop",
        timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      return stream;
    }) as typeof session.agent.streamFunction;

    await session.prompt(options.message ?? "Preview this request without sending it to a model.");
    if (!captured || streamCalls !== 1) throw new Error("Prompt preview did not capture exactly one provider context");
    const context = captured as Context;
    const projectLabel = selectedProject
      ? `Selected external project context: ${cwd}`
      : "Isolated temporary context (default): external project context is excluded";
    return {
      preview: {
        context: selectedProject ? "selected-project" : "isolated",
        label: projectLabel,
        cwd,
        transientSession: true,
        included: [
          projectSystemSelected ? projectSystemPath : "Die production system prompt",
          "Pi production system-prompt assembly",
          "Die production prompt/context extension hooks",
          ...(selectedProject ? ["project/ancestor AGENTS.md files discovered by Pi"] : []),
          ...(appendSelected ? [appendPath] : []),
          ...(options.goal ? ["representative paused goal state"] : []),
        ],
        excluded: [
          "network/model calls",
          "persistent session state",
          "global and project settings/packages",
          "global agent configuration",
          "saved conversation history and live running jobs",
          "completion/attention events, tool-result handoffs, and compaction requests",
          "project extensions, skills, prompt templates, and themes",
          ...(!selectedProject ? ["all external project files and guidance"] : []),
        ],
        role,
        ...(role === "root" ? { rootMode } : {}),
        networkRequests: 0,
      },
      model: { provider: model.provider, id: model.id },
      systemPrompt: context.systemPrompt ?? "",
      tools: context.tools ?? [],
      messages: context.messages,
    };
  } finally {
    session?.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
}
