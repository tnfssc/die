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

/**
 * Installs a hard synchronous guard at the concrete provider boundary. The
 * runtime wrapper disables retries before request preparation, while the
 * provider wrapper records only calls that actually survive preparation and
 * reach provider dispatch. A preparation/auth failure is therefore an
 * invocation, not falsely reported as a paid request.
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
