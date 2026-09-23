export interface LiveDispatchEvidence {
  request: number;
  provider: string;
  model: string;
  api: string;
  transport: string;
  dispatchedAt: string;
}

type StreamSimple = (...args: any[]) => unknown;

interface StreamProvider {
  streamSimple: StreamSimple;
}

interface StreamRuntime {
  streamSimple: StreamSimple;
  getProvider(providerId: string): StreamProvider | undefined;
}

interface AuthRuntime {
  hasConfiguredAuth(providerId: string): boolean;
  getAuth(model: unknown, options: { minOAuthValidityMs: number }): Promise<unknown>;
}

/** Find credentials and refresh them if needed before a paid smoke test. */
export async function assertLiveRuntimeReady(runtime: AuthRuntime, model: { provider: string }): Promise<void> {
  if (!runtime.hasConfiguredAuth(model.provider)) {
    throw new Error("Live smoke auth is not configured for provider: " + model.provider);
  }
  const auth = await runtime.getAuth(model, { minOAuthValidityMs: 300_000 });
  if (!auth) throw new Error("Live smoke could not resolve usable auth for provider: " + model.provider);
}

/**
 * Put a hard sync guard at the real provider boundary. The runtime wrapper turns
 * off retries before request setup. The provider wrapper records only calls that
 * finish setup and reach dispatch. Setup or auth failure counts as an invocation,
 * not a paid request.
 */
export function installLiveDispatchBudget(
  runtime: StreamRuntime,
  providerId: string,
  limit: number,
  onDispatch: (evidence: LiveDispatchEvidence) => void,
) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Dispatch limit must be a positive integer");
  }
  const provider = runtime.getProvider(providerId);
  if (!provider) throw new Error("Runtime provider is not initialized: " + providerId);

  const originalRuntimeStream = runtime.streamSimple;
  const originalProviderStream = provider.streamSimple;
  let invocations = 0;
  let dispatches = 0;

  runtime.streamSimple = ((model: any, context: unknown, options?: Record<string, unknown>) => {
    invocations++;
    return originalRuntimeStream.call(runtime, model, context, { ...options, maxRetries: 0 });
  }) as StreamSimple;

  provider.streamSimple = ((model: any, context: unknown, options?: Record<string, unknown>) => {
    if (dispatches >= limit) {
      throw new Error(`Live smoke exceeded its ${limit}-request dispatch limit`);
    }
    dispatches++;
    onDispatch({
      request: dispatches,
      provider: String(model.provider),
      model: String(model.id),
      api: String(model.api),
      transport: String(options?.transport),
      dispatchedAt: new Date().toISOString(),
    });
    return originalProviderStream.call(provider, model, context, options);
  }) as StreamSimple;

  return {
    get invocations() {
      return invocations;
    },
    get dispatches() {
      return dispatches;
    },
    restore() {
      runtime.streamSimple = originalRuntimeStream;
      provider.streamSimple = originalProviderStream;
    },
  };
}
