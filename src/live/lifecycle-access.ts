import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STOP = "die:live:stop";
export type LiveStopResult = { stopped: boolean; errors: string[]; jobsUnchanged: true };
type Request = {
  context: ExtensionContext;
  accept: (result: Promise<LiveStopResult | undefined>) => void;
};

/** Every matching owner must finish: CLI and web may both register on this bus. */
export async function stopCurrentLive(pi: ExtensionAPI, context: ExtensionContext): Promise<LiveStopResult> {
  const pending: Promise<LiveStopResult | undefined>[] = [];
  pi.events?.emit(STOP, {
    context,
    accept: (value) => {
      pending.push(value);
    },
  } satisfies Request);
  const results = (
    await Promise.all(
      pending.map(async (result) => {
        try {
          return await result;
        } catch {
          return { stopped: false, errors: ["Live lifecycle teardown failed"], jobsUnchanged: true } as LiveStopResult;
        }
      }),
    )
  ).filter((result): result is LiveStopResult => result !== undefined);
  if (!results.length)
    return { stopped: false, errors: ["No Live voice session belongs to this agent session"], jobsUnchanged: true };
  return {
    stopped: results.every((result) => result.stopped),
    errors: results.flatMap((result) => result.errors),
    jobsUnchanged: true,
  };
}

/** Return undefined when this lifecycle owner has no matching session. */
export function registerLiveStop(
  pi: ExtensionAPI,
  stop: (context: ExtensionContext) => Promise<LiveStopResult | undefined>,
): void {
  pi.events?.on?.(STOP, (value: unknown) => {
    const request = value as Request;
    if (request?.context && typeof request.accept === "function")
      request.accept(Promise.resolve().then(() => stop(request.context)));
  });
}
