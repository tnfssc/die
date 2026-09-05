import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import * as codex from "@earendil-works/pi-ai/api/openai-codex-responses";
import * as anthropic from "@earendil-works/pi-ai/api/anthropic-messages";
import {
  ModelRuntime,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import tasks from "../src/tasks/extension";
import phase1Fixture from "./phase1-compaction-fixture";

const sentinel = "offline-compaction-sdk-capture";
const usage = {
  input: 20,
  output: 5,
  cacheRead: 100,
  cacheWrite: 0,
  totalTokens: 125,
  cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0, total: 0.031 },
};
const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
const jwt =
  enc({ alg: "none" }) +
  "." +
  enc({ "https://api.openai.com/auth": { chatgpt_account_id: "offline-test" } }) +
  ".signature";

for (const [provider, id, api] of [
  ["openai-codex", "gpt-5.6-luna", codex],
  ["anthropic", "claude-sonnet-4-5", anthropic],
] as const) {
  test(provider + " actual SDK compaction preserves provider prefix and thinking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-compact-sdk-"));
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    let networkCalls = 0;
    const notifications: string[] = [];
    let restoreNotify = () => {};
    const captured: any[] = [];
    const attempts: any[] = [];
    try {
      const model =
        provider === "openai-codex"
          ? getModel("openai-codex", "gpt-5.6-luna")!
          : getModel("anthropic", "claude-sonnet-4-5")!;
      const runtime = await ModelRuntime.create({
        authPath: join(dir, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.hasConfiguredAuth = () => true;
      runtime.getAuth = (async () => ({ auth: { apiKey: provider === "openai-codex" ? jwt : "offline-key" } })) as any;
      let compacting = false;
      function fixture(serializer: any, m: any, context: any, options: any) {
        const output = createAssistantMessageEventStream();
        void (async () => {
          const headers = (await options?.transformHeaders?.(options?.headers ?? {})) ?? options?.headers;
          const observed = await serializer(m, context, {
            ...options,
            headers,
            apiKey: provider === "openai-codex" ? jwt : "offline-key",
            transport: "sse",
            fetch: async () => {
              networkCalls++;
              throw Error("unexpected network");
            },
            onPayload: async (payload: any) => {
              attempts.push(structuredClone(payload));
              const result = await options?.onPayload?.(payload, m);
              captured.push({ compacting, headers, payload: structuredClone(result ?? payload) });
              throw Error(sentinel);
            },
          }).result();
          if (!observed.errorMessage?.includes(sentinel)) {
            output.push({ type: "error", reason: "error", error: observed });
            output.end(observed);
            return;
          }
          const message: AssistantMessage = {
            role: "assistant",
            api: m.api,
            provider: m.provider,
            model: m.id,
            content: [
              {
                type: "text",
                text: compacting
                  ? "## Goal\nPreserve fixture state.\n## Critical Context\nfixture-checkpoint"
                  : "Fixture acknowledged.",
              },
            ],
            stopReason: "stop",
            usage,
            timestamp: Date.now(),
          };
          output.push({ type: "done", reason: "stop", message });
          output.end(message);
        })().catch((e) => {
          const message: any = {
            role: "assistant",
            api: m.api,
            provider: m.provider,
            model: m.id,
            content: [],
            stopReason: "error",
            errorMessage: String(e),
            usage,
            timestamp: Date.now(),
          };
          output.push({ type: "error", reason: "error", error: message });
          output.end(message);
        });
        return output;
      }
      // Exercise the real simple/native provider option mappings, rather than a
      // mock complete() that accepts options the real serializer would ignore.
      runtime.streamSimple = ((m: any, c: any, o: any) => fixture(api.streamSimple, m, c, o)) as any;
      runtime.stream = ((m: any, c: any, o: any) => fixture(api.stream, m, c, o)) as any;
      const realProvider = runtime.getProvider(provider)!;
      runtime.getProvider = (() => ({
        ...realProvider,
        streamSimple: (m: any, c: any, o: any) => fixture(api.streamSimple, m, c, o),
      })) as any;
      const manager = SessionManager.inMemory(dir);
      manager.appendMessage({
        role: "user",
        content: "Old task fixture. " + "context-detail ".repeat(500),
        timestamp: 1,
      });
      manager.appendMessage({
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: "text", text: "Old task noted." }],
        stopReason: "stop",
        usage,
        timestamp: 2,
      });
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        extensionFactories: [
          {
            name: "observe",
            factory: (pi) => {
              pi.on("before_provider_headers", (event) => {
                event.headers["x-die-fixture-routing"] = "same-route";
              });
              pi.on("before_agent_start", (_e, ctx) => {
                const ui = ctx.ui;
                const original = ui.notify;
                ui.notify = (message) => {
                  notifications.push(message);
                };
                restoreNotify = () => {
                  ui.notify = original;
                };
              });
            },
          },
          { name: "die-tasks", factory: provider === "openai-codex" ? phase1Fixture : tasks },
        ],
      });
      await loader.reload();
      ({ session } = await createAgentSession({
        cwd: dir,
        agentDir: dir,
        resourceLoader: loader,
        model,
        modelRuntime: runtime,
        sessionManager: manager,
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 8192 },
        }),
        thinkingLevel: "medium",
        tools: ["execute"],
      }));
      await session.prompt("Keep the current request as recent detail. " + "recent-detail ".repeat(100));
      expect(captured).toHaveLength(1);
      compacting = true;
      await session.compact();
      const checkpoint = manager
        .getEntries()
        .slice()
        .reverse()
        .find((e) => e.type === "compaction") as any;
      if (checkpoint?.details?.strategy !== "cache-affine-plaintext") {
        await Bun.write(
          "artifacts/compaction/sdk-failure-" + provider + "-" + Date.now() + ".json",
          JSON.stringify(attempts, null, 2),
        );
        const before = attempts[0],
          after = attempts[1];
        console.log(provider, "notifications", notifications);
        console.log(
          provider,
          "mismatched fields",
          Object.keys(before ?? {}).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after?.[k])),
        );
      }
      expect(checkpoint?.details?.strategy).toBe("cache-affine-plaintext");
      expect(checkpoint.usage).toEqual(usage);
      expect(checkpoint.fromHook).toBe(true);
      expect(captured).toHaveLength(2);
      const first = captured[0].payload,
        last = captured[1].payload;
      expect(last.tools).toEqual(first.tools);
      expect(captured[1].headers["x-die-fixture-routing"]).toBe("same-route");
      if (provider === "openai-codex") {
        expect(last.instructions).toBe(first.instructions);
        expect(last.reasoning).toEqual(first.reasoning);
        expect(last.prompt_cache_key).toBe(first.prompt_cache_key);
      } else {
        expect(last.system).toEqual(first.system);
        expect(last.thinking).toEqual(first.thinking);
      }
      expect(networkCalls).toBe(0);
    } finally {
      restoreNotify();
      session?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
}
