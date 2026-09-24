/** Only these locally defined reasons may cross the tool response boundary. */
const publicReasons = {
  transcript_unavailable: "Handoff requires an eligible completed captured user transcript. This request was not sent.",
  request_already_used: "Handoff request ID was already attempted and cannot select another transcript.",
  request_limit: "Handoff request limit reached for this live session. No transcript was sent.",
} as const;

export class PublicToolFailure extends Error {
  constructor(readonly code: keyof typeof publicReasons) {
    super(publicReasons[code]);
  }
}

export function toolFailureResponse(error: unknown): Record<string, unknown> {
  if (error instanceof PublicToolFailure && Object.hasOwn(publicReasons, error.code)) {
    return { error: publicReasons[error.code], code: error.code };
  }
  return { error: "Tool execution failed" };
}
