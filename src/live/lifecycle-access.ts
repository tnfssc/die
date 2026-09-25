import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STOP = "die:live:stop";
export type LiveStopResult = { stopped: boolean; errors: string[]; jobsUnchanged: true };
type Request = {
  context: ExtensionContext;
  accept: (result: Promise<LiveStopResult>) => void;
};

/** A session-scoped request through the same shared extension bus as Live host access. */
export async function stopCurrentLive(pi: ExtensionAPI, context: ExtensionContext): Promise<LiveStopResult> {
  let result: Promise<LiveStopResult> | undefined;
  pi.events?.emit(STOP, {
    context,
    accept: (value) => {
      result = value;
    },
  } satisfies Request);
  if (!result) return { stopped: false, errors: ["Live lifecycle is unavailable"], jobsUnchanged: true };
  return result;
}

export function registerLiveStop(pi: ExtensionAPI, stop: (context: ExtensionContext) => Promise<LiveStopResult>): void {
  pi.events?.on?.(STOP, (value: unknown) => {
    const request = value as Request;
    if (request?.context && typeof request.accept === "function") request.accept(stop(request.context));
  });
}
