import { InputHandoffError, inputHandoffReasons } from "../session/input";

/** Only these locally defined reasons may cross the tool response boundary. */
const publicReasons = inputHandoffReasons;

export function toolFailureResponse(error: unknown): Record<string, unknown> {
  if (error instanceof InputHandoffError && Object.hasOwn(publicReasons, error.code)) {
    return { error: publicReasons[error.code], code: error.code };
  }
  return { error: "Tool execution failed" };
}
