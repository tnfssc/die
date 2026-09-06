import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recordDiagnostic } from "../diagnostics.js";
import { subscribeProviderAttempts } from "./provider-attempts";

export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
export const CACHE_CALL_ENTRY = "die-cache-call";
export const CACHE_OBSERVATION_RECORDED = "cache_observation_recorded";
export const CACHE_CORRELATION_UNAVAILABLE = "cache_correlation_unavailable";
export const CACHE_HTTP_REJECTED = "http_rejected";
export const CACHE_OBSERVER_FAILED = "observer_failed";
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CacheSettings {
  ttlMs: number;
}
export interface CacheCall {
  timestamp: number;
  provider: string;
  model: string;
}
export interface CacheEstimate {
  state: "unknown" | "active" | "warning" | "urgent" | "expired";
  text: string;
  nextUpdateMs?: number;
}

export function cacheSettingsPath(): string {
  return join(homedir(), ".die", "cache-settings.json");
}
export function parseCacheSettings(value: unknown): CacheSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("settings must be an object");
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "cacheTtlMs"))
    throw new Error("unknown setting: " + keys.find((key) => key !== "cacheTtlMs"));
  const ttlMs = (value as { cacheTtlMs?: unknown }).cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || (ttlMs as number) < MIN_TTL_MS || (ttlMs as number) > MAX_TTL_MS) {
    throw new Error("cacheTtlMs must be an integer from 60000 to 604800000");
  }
  return { ttlMs: ttlMs as number };
}
export async function loadCacheSettings(path = cacheSettingsPath()): Promise<CacheSettings> {
  try {
    return parseCacheSettings(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ttlMs: DEFAULT_CACHE_TTL_MS };
    throw new Error("Invalid cache settings at " + path + ": " + String(error));
  }
}
export async function saveCacheSettings(settings: CacheSettings, path = cacheSettingsPath()): Promise<void> {
  const value = parseCacheSettings({ cacheTtlMs: settings.ttlMs });
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify({ cacheTtlMs: value.ttlMs }, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Parse an explicit, bounded duration. Bare numbers are minutes. */
export function parseCacheTtl(input: string): number {
  const match = input
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|day|days)?$/);
  if (!match) throw new Error("Use a duration such as 30m, 1h, or 1d");
  const amount = Number(match[1]);
  const unit = match[2] ?? "m";
  const multiplier = unit.startsWith("d") ? 86_400_000 : unit.startsWith("h") ? 3_600_000 : 60_000;
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result) || result < MIN_TTL_MS || result > MAX_TTL_MS)
    throw new Error("TTL must be between 1 minute and 7 days");
  return result;
}
export function formatCacheTtl(ms: number): string {
  if (ms % 86_400_000 === 0) return ms / 86_400_000 + "d";
  if (ms % 3_600_000 === 0) return ms / 3_600_000 + "h";
  return ms / 60_000 + "m";
}
function validCall(value: unknown): value is CacheCall {
  const call = value as CacheCall;
  return (
    !!call &&
    Number.isFinite(call.timestamp) &&
    call.timestamp > 0 &&
    typeof call.provider === "string" &&
    !!call.provider &&
    typeof call.model === "string" &&
    !!call.model
  );
}

/**
 * Informational estimate only. A record means a provider request was observed
 * at an HTTP response or successful terminal message; it does not assert cache
 * creation, compatibility, or a cache hit.
 */
export class CacheCountdown {
  ttlMs = DEFAULT_CACHE_TTL_MS;
  private calls = new Map<string, number>();
  private listeners = new Set<() => void>();
  constructor(private now: () => number = Date.now) {}
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* optional UI observer */
      }
    }
  }
  setTtl(ttlMs: number) {
    if (this.ttlMs !== ttlMs) {
      this.ttlMs = ttlMs;
      this.changed();
    }
  }
  modelChanged() {
    this.changed();
  }
  invalidate() {
    this.calls.clear();
    this.changed();
  }
  restore(ctx: ExtensionContext) {
    this.calls.clear();
    if (!ctx.sessionManager?.getEntries) {
      this.changed();
      return;
    }
    const manager = ctx.sessionManager as typeof ctx.sessionManager & {
      getBranch?: () => ReturnType<typeof ctx.sessionManager.getEntries>;
    };
    for (const entry of manager.getBranch?.() ?? manager.getEntries()) {
      // A shake changes the serialized prompt prefix. Do not display a TTL for
      // the pre-shake request after resume; later observed calls repopulate it.
      if (entry.type === "custom" && entry.customType === "die-manual-shake") this.calls.clear();
      else if (entry.type === "custom" && entry.customType === CACHE_CALL_ENTRY && validCall(entry.data)) {
        const key = entry.data.provider + "/" + entry.data.model;
        this.calls.set(key, Math.max(this.calls.get(key) ?? 0, entry.data.timestamp));
      }
    }
    this.changed();
  }
  record(pi: ExtensionAPI, model: Pick<Model<any>, "provider" | "id"> | undefined, timestamp = this.now()) {
    if (!model) return;
    const call = { timestamp, provider: model.provider, model: model.id };
    // Persist first. An append failure must not leave an in-memory estimate that
    // claims an observation which cannot survive resume.
    pi.appendEntry(CACHE_CALL_ENTRY, call);
    this.calls.set(call.provider + "/" + call.model, timestamp);
    this.changed();
  }
  estimate(ctx: Pick<ExtensionContext, "model">, now = this.now()): CacheEstimate {
    const model = ctx.model;
    const timestamp = model ? this.calls.get(model.provider + "/" + model.id) : undefined;
    if (timestamp === undefined) return { state: "unknown", text: "cache est ?" };
    const remaining = timestamp + this.ttlMs - now;
    if (remaining <= 0) return { state: "expired", text: "cache est expired" };
    const minutes = Math.max(1, Math.ceil(remaining / 60_000));
    const state = remaining <= 5 * 60_000 ? "urgent" : remaining <= 15 * 60_000 ? "warning" : "active";
    // Wake only when the visible minute or warning state can change.
    const nextUpdateMs = Math.max(1, remaining - (minutes - 1) * 60_000);
    return { state, text: "cache est " + minutes + "m", nextUpdateMs };
  }
}

export function registerCacheCountdown(pi: ExtensionAPI, countdown: CacheCountdown, path = cacheSettingsPath()): void {
  let loadError: Error | undefined;
  const ready = loadCacheSettings(path)
    .then((settings) => countdown.setTtl(settings.ttlMs))
    .catch((error) => {
      loadError = error instanceof Error ? error : new Error(String(error));
    });
  let unsubscribe = () => {};
  let owner: object | undefined;
  type Attempt = {
    operationId: string;
    model: Pick<Model<any>, "provider" | "id">;
    startedAt: number;
  };
  const attempts = new Map<string, Attempt>();
  // HTTP response hooks and assistant terminal hooks can both describe the same
  // request, but expose no shared correlation token. Remember HTTP-observed
  // models so a later terminal event can never be reassigned to an overlapping
  // WebSocket attempt.
  const httpTerminalDebt = new Map<string, number>();
  const modelKey = (model: Pick<Model<any>, "provider" | "id">) => model.provider + "/" + model.id;
  const diagnostic = (input: Parameters<typeof recordDiagnostic>[1]) => {
    if (owner) recordDiagnostic(owner, input);
  };
  const record = (
    attempt: Attempt,
    model: Pick<Model<any>, "provider" | "id">,
    timestamp: number,
    dispatch: "response" | "initiated",
  ) => {
    try {
      countdown.record(pi, model, timestamp);
      diagnostic({
        component: "cache",
        code: CACHE_OBSERVATION_RECORDED,
        outcome: "success",
        operationId: attempt.operationId,
        dispatch,
      });
    } catch {
      diagnostic({
        component: "observer",
        code: CACHE_OBSERVER_FAILED,
        outcome: "failed",
        operationId: attempt.operationId,
        dispatch,
      });
    }
  };
  const candidates = (model: Pick<Model<any>, "provider" | "id">): Attempt[] =>
    [...attempts.values()].filter(
      (attempt) => attempt.model.provider === model.provider && attempt.model.id === model.id,
    );
  const block = (blocked: Attempt[]) => {
    for (const attempt of blocked) attempts.delete(attempt.operationId);
    diagnostic({
      component: "cache",
      code: CACHE_CORRELATION_UNAVAILABLE,
      outcome: "blocked",
      dispatch: "unknown",
      count: blocked.length,
    });
  };
  const correlate = (model: Pick<Model<any>, "provider" | "id"> | undefined): Attempt | undefined => {
    // The SDK's HTTP hook has no model identity. Its response can only be
    // attributed when exactly one request snapshot is outstanding. With
    // overlap, discard every candidate rather than guessing by insertion order.
    if (!model) {
      if (attempts.size === 1) return attempts.values().next().value;
      if (attempts.size > 1) block([...attempts.values()]);
      return undefined;
    }
    const matches = candidates(model);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) block(matches);
    return undefined;
  };
  pi.on("session_start", async (_event, ctx) => {
    unsubscribe();
    countdown.restore(ctx);
    attempts.clear();
    httpTerminalDebt.clear();
    owner = ctx.sessionManager && typeof ctx.sessionManager === "object" ? ctx.sessionManager : undefined;
    if (owner) {
      unsubscribe = subscribeProviderAttempts(owner, (event) => {
        // Dispatch only proves that fetch was invoked. It does not prove that
        // the provider accepted the request (a later HTTP 401 is one example).
        if (event.observedAt === "response")
          record(
            { operationId: event.operationId, model: event.model, startedAt: event.timestamp },
            event.model,
            event.timestamp,
            "response",
          );
      });
    }
    await ready;
    if (loadError)
      ctx.ui?.notify?.(
        loadError.message + ". The file was left unchanged; using the default cache estimate.",
        "warning",
      );
  });
  pi.on("session_shutdown", () => {
    unsubscribe();
    unsubscribe = () => {};
    owner = undefined;
    attempts.clear();
    httpTerminalDebt.clear();
  });
  pi.on("before_provider_request", (_event, ctx) => {
    const model = ctx.model;
    if (!model) return;
    const attempt: Attempt = {
      operationId: randomUUID(),
      model: { provider: model.provider, id: model.id },
      startedAt: Date.now(),
    };
    attempts.set(attempt.operationId, attempt);
  });
  pi.on("after_provider_response", (event) => {
    const response = event as typeof event & { model?: Pick<Model<any>, "provider" | "id"> };
    const attempt = correlate(response.model);
    if (!attempt) return;
    attempts.delete(attempt.operationId);
    // A terminal message follows an HTTP response, including a rejected one.
    // Key that debt by the request snapshot when the SDK omits model identity,
    // so the terminal hook cannot turn a rejected response into an observation.
    const responseModel = response.model ?? attempt.model;
    const key = modelKey(responseModel);
    httpTerminalDebt.set(key, (httpTerminalDebt.get(key) ?? 0) + 1);
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      diagnostic({
        component: "cache",
        code: CACHE_HTTP_REJECTED,
        outcome: "noop",
        operationId: attempt.operationId,
        dispatch: "response",
        ...(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
          ? { httpStatus: response.status }
          : {}),
      });
      return;
    }
    record(attempt, responseModel, Date.now(), "response");
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const message = event.message as typeof event.message & { provider?: string; model?: string };
    const model =
      typeof message.provider === "string" && typeof message.model === "string"
        ? { provider: message.provider, id: message.model }
        : undefined;
    if (model) {
      const key = modelKey(model);
      const debt = httpTerminalDebt.get(key) ?? 0;
      if (debt > 0) {
        if (debt === 1) httpTerminalDebt.delete(key);
        else httpTerminalDebt.set(key, debt - 1);
        // If another request for the same model started before this terminal
        // hook arrived, the hook could belong to either request. Drop every
        // matching candidate rather than falsely consuming the newer one.
        const overlapping = candidates(model);
        if (overlapping.length > 0) block(overlapping);
        return;
      }
    }
    const attempt = correlate(model);
    if (!attempt) return;
    attempts.delete(attempt.operationId);
    if (event.message.stopReason === "error" || event.message.stopReason === "aborted") return;
    // A successful terminal event covers WebSocket transports. Request start is
    // conservative: streaming time is never added to the displayed TTL.
    record(attempt, model ?? attempt.model, attempt.startedAt, "initiated");
  });
  pi.on("model_select", () => countdown.modelChanged());
  pi.registerCommand("cache-ttl", {
    description: "Show or set the informational provider-cache TTL estimate",
    handler: async (args, ctx) => {
      await ready;
      const value = args.trim();
      if (!value) {
        ctx.ui.notify(
          "Cache TTL estimate: " +
            formatCacheTtl(countdown.ttlMs) +
            ". Informational only; not a provider cache guarantee.",
          "info",
        );
        return;
      }
      try {
        const ttlMs = parseCacheTtl(value);
        await saveCacheSettings({ ttlMs }, path);
        countdown.setTtl(ttlMs);
        loadError = undefined;
        ctx.ui.notify(
          "Cache TTL estimate set to " +
            formatCacheTtl(ttlMs) +
            ". This does not guarantee provider cache retention or hits.",
          "info",
        );
      } catch (error) {
        ctx.ui.notify("Invalid cache TTL: " + (error instanceof Error ? error.message : String(error)), "error");
      }
    },
  });
}
