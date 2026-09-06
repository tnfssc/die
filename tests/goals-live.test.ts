import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getModels } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import tasks from "../src/tasks/extension";
import { assertLiveRuntimeReady, installLiveDispatchBudget, type LiveDispatchEvidence } from "./live-dispatch-budget";

// This is a paid, single-scenario smoke test, not a claim about general goal quality.
// No mocked stream is used: /goal is dispatched by the SDK and the configured model
// must use die's real execute/goal helpers to create and complete the criterion.
test.skipIf(process.env.DIE_RUN_LLM_TESTS !== "1")(
  "live goal mode completes a harmless temporary-file criterion",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-goal-live-"));
    const evidenceDir = resolve("artifacts/goals");
    const evidenceFile = join(evidenceDir, "live-" + Date.now() + ".json");
    const marker = "DIE_GOAL_CRITERION=" + randomUUID();
    const criterionFile = join(dir, "criterion.txt");
    const transport = "sse";
    const evidence: Record<string, unknown> = {
      phase: "setup",
      transport,
      requests: [],
      usage: [],
    };
    const requestEvidence: LiveDispatchEvidence[] = [];
    const usageEvidence: Array<Record<string, unknown>> = [];
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    let manager: SessionManager | undefined;
    let budget: ReturnType<typeof installLiveDispatchBudget> | undefined;
    let wallTimer: ReturnType<typeof setTimeout> | undefined;
    let wallAbort: Promise<void> | undefined;
    let workflow: Promise<void> | undefined;

    try {
      const modelId = process.env.DIE_GOAL_MODEL ?? process.env.DIE_COMPACTION_MODEL ?? "gpt-5.6-luna";
      const model = getModels("openai-codex").find((candidate) => candidate.id === modelId);
      if (!model) throw new Error("Unknown DIE_GOAL_MODEL: " + modelId);
      evidence.model = model.provider + "/" + model.id;

      const agentDir = process.env.DIE_CODING_AGENT_DIR ?? join(homedir(), ".die", "agent");
      const runtime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      evidence.phase = "auth-preflight";
      await assertLiveRuntimeReady(runtime, model);
      evidence.authReady = true;
      // This guard is on the real runtime method, outside extension error handling.
      // maxRetries=0 makes each admitted call correspond to at most one paid dispatch.
      budget = installLiveDispatchBudget(runtime, model.provider, 4, (item) => requestEvidence.push(item));
      manager = SessionManager.create(dir, join(dir, "sessions"));
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        extensionFactories: [
          {
            name: "die-tasks",
            factory: (pi) =>
              tasks(pi, {
                executablePath: resolve(import.meta.dir, "../dist/die"),
              }),
          },
        ],
      });
      await loader.reload();
      ({ session } = await createAgentSession({
        cwd: dir,
        agentDir,
        resourceLoader: loader,
        model,
        modelRuntime: runtime,
        sessionManager: manager,
        settingsManager: SettingsManager.inMemory({
          transport,
          compaction: { enabled: false },
        }),
        thinkingLevel: "medium",
        tools: ["execute"],
      }));
      session.subscribe((event) => {
        if (event.type !== "message_end" || event.message.role !== "assistant") return;
        if (usageEvidence.length >= 6) return;
        usageEvidence.push({
          stopReason: event.message.stopReason,
          errorMessage:
            event.message.errorMessage === undefined ? undefined : String(event.message.errorMessage).slice(0, 2_000),
          usage: event.message.usage,
          toolNames: event.message.content
            .filter((part) => part.type === "toolCall")
            .map((part) => part.name)
            .slice(0, 8),
        });
      });

      let rejectWall!: (reason: Error) => void;
      const wallFailure = new Promise<never>((_resolve, reject) => {
        rejectWall = reject;
      });
      wallTimer = setTimeout(() => {
        wallAbort = session?.abort() ?? Promise.resolve();
        rejectWall(new Error("Goal live smoke exceeded its 120-second wall limit"));
      }, 120_000);

      workflow = (async () => {
        evidence.phase = "goal-command";
        await session!.prompt(
          "/goal set Create and verify the harmless temporary criterion artifact at " +
            criterionFile +
            " --criteria Write that file with the exact UTF-8 text " +
            marker +
            "; Read it back and confirm exact contents; Persist completed goal evidence after verification" +
            " --constraints Use only the local temporary directory; Do not start background jobs or subagents; Keep evidence concise",
        );
        for (let attempt = 0; attempt < 12_000 && usageEvidence.length === 0; attempt++) await Bun.sleep(10);
        if (usageEvidence.length === 0) throw new Error("Provider response was not observed before the wall limit");
        await session!.waitForIdle();

        const lastAssistant = usageEvidence.at(-1);
        if (!lastAssistant || lastAssistant.stopReason === "error") {
          throw new Error(
            "Provider failed before artifact verification: " +
              String(lastAssistant?.errorMessage ?? "assistant response was not observed"),
          );
        }
        expect(budget!.dispatches).toBeGreaterThan(0);
        const artifact = await readFile(criterionFile);
        expect(artifact.toString("utf8")).toBe(marker);
        const goalEntries = manager!
          .getEntries()
          .filter((entry: any) => entry.type === "custom" && entry.customType === "die-goal") as any[];
        const completed = goalEntries.at(-1)?.data?.goal;
        expect(completed).toMatchObject({ status: "completed" });
        expect(typeof completed.evidence).toBe("string");
        expect(completed.evidence.length).toBeGreaterThan(0);
        expect(completed.evidence.length).toBeLessThanOrEqual(4_000);
        expect(budget!.dispatches).toBeGreaterThan(0);
        expect(budget!.dispatches).toBeLessThanOrEqual(4);

        const sessionFile = manager!.getSessionFile();
        expect(sessionFile).toBeDefined();
        const durableLines = (await readFile(sessionFile!, "utf8")).trim().split("\n");
        expect(
          durableLines.some((line) => {
            const entry = JSON.parse(line);
            return (
              entry.type === "custom" && entry.customType === "die-goal" && entry.data?.goal?.status === "completed"
            );
          }),
        ).toBe(true);

        evidence.phase = "complete";
        evidence.goal = {
          status: completed.status,
          revisions: goalEntries.length,
          evidenceChars: completed.evidence.length,
        };
        evidence.criterion = {
          bytes: artifact.byteLength,
          sha256: createHash("sha256").update(artifact).digest("hex"),
        };
        evidence.sessionEntries = manager!.getEntries().length;
      })();
      await Promise.race([workflow, wallFailure]);
    } catch (error) {
      evidence.phase = "failed";
      evidence.error = String(error).slice(0, 2_000);
      throw error;
    } finally {
      if (wallTimer) clearTimeout(wallTimer);
      if (wallAbort) await wallAbort;
      else if (session) await session.abort();
      if (workflow) await Promise.allSettled([workflow]);
      budget?.restore();
      evidence.runtimeInvocations = budget?.invocations ?? 0;
      evidence.providerDispatches = budget?.dispatches ?? 0;
      evidence.requests = requestEvidence;
      evidence.usage = usageEvidence;
      const goalEntries =
        manager?.getEntries().filter((entry: any) => entry.type === "custom" && entry.customType === "die-goal") ?? [];
      const latestGoal = (goalEntries.at(-1) as any)?.data?.goal;
      if (latestGoal) {
        evidence.goal = {
          status: latestGoal.status,
          revisions: goalEntries.length,
          evidenceChars: typeof latestGoal.evidence === "string" ? latestGoal.evidence.length : 0,
          pauseReason: latestGoal.pauseReason,
        };
      }
      evidence.sessionEntries ??= manager?.getEntries().length ?? 0;
      session?.dispose();
      await mkdir(evidenceDir, { recursive: true });
      await Bun.write(evidenceFile, JSON.stringify(evidence, null, 2) + "\n");
      console.log("Goal live evidence: " + evidenceFile);
      await rm(dir, { recursive: true, force: true });
    }
  },
  150_000,
);
