export interface LiveDispatchEvidence {
  request: number;
  provider: string;
  model: string;
  api: string;
  transport: string;
  dispatchedAt: string;
}

type StreamSimple = (...args: any[]) => unknown;

interface StreamRuntime {
  streamSimple: StreamSimple;
}

/**
 * Installs a synchronous guard at the ModelRuntime boundary. Unlike extension
 * events, an error here propagates to the agent and cannot be swallowed by an
 * extension runner. Retries are disabled so one admitted stream call can make
 * at most one provider dispatch; all other stream options, including the
 * explicitly configured transport, pass through unchanged.
 */
export function installLiveDispatchBudget(
  runtime: StreamRuntime,
  limit: number,
  onDispatch: (evidence: LiveDispatchEvidence) => void,
) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Dispatch limit must be a positive integer");
  }
  const original = runtime.streamSimple;
  let dispatches = 0;
  let attempts = 0;

  runtime.streamSimple = ((model: any, context: unknown, options?: Record<string, unknown>) => {
    attempts++;
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
    return original.call(runtime, model, context, { ...options, maxRetries: 0 });
  }) as StreamSimple;

  return {
    get attempts() {
      return attempts;
    },
    get dispatches() {
      return dispatches;
    },
    restore() {
      runtime.streamSimple = original;
    },
  };
}
