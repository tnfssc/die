import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createPromptPreview } from "../src/prompt-preview";
import { executeGuidance } from "../src/prompts";
import { registerExecuteTool } from "../src/typescript/extension";

test("offline preview captures production prompt, tool definition, and injected messages", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation((() => {
    throw new Error("prompt preview attempted network access");
  }) as unknown as typeof globalThis.fetch);
  try {
    let registered!: ToolDefinition;
    registerExecuteTool({
      registerTool(tool: ToolDefinition) {
        registered = tool;
      },
      on() {},
    } as unknown as ExtensionAPI);

    const preview = await createPromptPreview({
      message: "USER_PREVIEW_MARKER",
      goal: "GOAL_PREVIEW_MARKER",
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(preview.preview.context).toBe("isolated");
    expect(preview.preview.label).toContain("external project context is excluded");
    expect(preview.preview.transientSession).toBe(true);
    expect(preview.preview.networkRequests).toBe(0);
    expect(preview.preview.role).toBe("root");
    expect(preview.preview.rootMode).toBe("orchestrator");
    expect(preview.systemPrompt).toContain("You lead work.");
    expect(preview.systemPrompt).not.toContain("Available tools:");
    expect(preview.systemPrompt).not.toContain("In addition to the tools above");
    for (const guidance of executeGuidance) expect(preview.systemPrompt).toContain(guidance);
    expect(preview.systemPrompt).not.toContain("Delegation is disabled");
    expect(preview.systemPrompt).toContain("Current working directory:");
    expect(preview.tools).toHaveLength(1);
    expect(preview.tools[0]).toMatchObject({
      name: registered.name,
      description: registered.description,
      parameters: registered.parameters,
    });
    expect(preview.tools[0]!.description).toBe(
      (await Bun.file(new URL("../src/prompts/execute-description.md", import.meta.url)).text()).trimEnd(),
    );
    expect(JSON.stringify(preview.messages)).toContain("USER_PREVIEW_MARKER");
    expect(JSON.stringify(preview.messages)).toContain("Persistent goal state (authoritative)");
    expect(JSON.stringify(preview.messages)).toContain("GOAL_PREVIEW_MARKER");
  } finally {
    fetch.mockRestore();
  }
});

test("root modes and explicitly selected project guidance pass through real assembly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-prompt-preview-project-"));
  try {
    await writeFile(join(dir, "AGENTS.md"), "PROJECT_PREVIEW_GUIDANCE");
    const preview = await createPromptPreview({ project: dir, rootMode: "fast" });

    expect(preview.preview.context).toBe("selected-project");
    expect(preview.preview.label).toContain(dir);
    expect(preview.preview.included).toContain("project/ancestor AGENTS.md files discovered by Pi");
    expect(preview.systemPrompt).toContain("PROJECT_PREVIEW_GUIDANCE");
    expect(preview.systemPrompt).toContain("Next agent not hear whole talk.");
    expect(preview.systemPrompt).not.toContain("main agent in fast instruction mode");
    expect(preview.systemPrompt).not.toContain("You build and fix code.");
    expect(preview.systemPrompt).not.toContain("You lead work.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selected project base and append are included without loading settings or writing project state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-prompt-preview-custom-"));
  const fetch = spyOn(globalThis, "fetch").mockImplementation((() => {
    throw new Error("prompt preview attempted network access");
  }) as unknown as typeof globalThis.fetch);
  try {
    await mkdir(join(dir, ".die"));
    await writeFile(join(dir, ".die", "SYSTEM.md"), "CUSTOM_PREVIEW_BASE");
    await writeFile(join(dir, ".die", "APPEND_SYSTEM.md"), "CUSTOM_PREVIEW_APPEND");
    await writeFile(join(dir, ".die", "settings.json"), JSON.stringify({ packages: ["npm:preview-must-not-install"] }));
    const before = await readdir(dir);
    const preview = await createPromptPreview({ project: dir, goal: "CUSTOM_GOAL" });
    expect(preview.systemPrompt).toContain("CUSTOM_PREVIEW_BASE");
    expect(preview.systemPrompt).toContain("CUSTOM_PREVIEW_APPEND");
    expect(preview.systemPrompt).toContain("Next agent not hear whole talk.");
    expect(preview.systemPrompt).not.toContain("Quick work? Finish it.");
    expect(preview.systemPrompt).not.toContain("You lead work.");
    expect(JSON.stringify(preview.messages)).toContain("CUSTOM_GOAL");
    expect(preview.preview.excluded).toContain("global and project settings/packages");
    expect(await readdir(dir)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("workspace reference and role judgment reach real root and child assembly", async () => {
  const judgment = "Independent code or PR work? Give it a worktree.";
  for (const role of ["root", "orchestrator", "normal"] as const) {
    const preview = await createPromptPreview({ role });
    expect(preview.preview.networkRequests).toBe(0);
    expect(preview.systemPrompt).toContain("title?, workspace?");
    expect(preview.systemPrompt).toContain("one pinned commit");
    if (role === "normal") expect(preview.systemPrompt).not.toContain(judgment);
    else expect(preview.systemPrompt.split(judgment)).toHaveLength(2);
  }
});

test("custom child base and append preserve role framing without injecting Die API prose", async () => {
  const dir = await mkdtemp(join("/var/tmp", "die-workspace-prompt-"));
  try {
    await mkdir(join(dir, ".die"));
    await writeFile(join(dir, ".die", "SYSTEM.md"), "WORKSPACE_CUSTOM_BASE");
    await writeFile(join(dir, ".die", "APPEND_SYSTEM.md"), "WORKSPACE_CUSTOM_APPEND");
    const preview = await createPromptPreview({ project: dir, role: "orchestrator" });
    expect(preview.preview.networkRequests).toBe(0);
    expect(preview.systemPrompt).toContain("WORKSPACE_CUSTOM_BASE");
    expect(preview.systemPrompt).toContain("WORKSPACE_CUSTOM_APPEND");
    expect(preview.systemPrompt).toContain("You are a orchestrator sub-agent.");
    expect(preview.systemPrompt).toContain("Independent code or PR work? Give it a worktree.");
    expect(preview.systemPrompt).not.toContain("title?, workspace?");
    expect(preview.systemPrompt).not.toContain("Quick work? Finish it.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
