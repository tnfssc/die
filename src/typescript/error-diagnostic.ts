export const MAX_ERROR_DIAGNOSTIC_CHARACTERS = 16_384;

const TRUNCATION_NOTICE = "\n… error diagnostic truncated";

type PropertyRead = { value?: string; unavailable: boolean };

function readStringProperty(error: Error, property: "name" | "message" | "stack"): PropertyRead {
  try {
    const value = error[property];
    return { value: value === undefined ? undefined : String(value), unavailable: false };
  } catch {
    return { unavailable: true };
  }
}

function boundDiagnostic(diagnostic: string): string {
  if (diagnostic.length <= MAX_ERROR_DIAGNOSTIC_CHARACTERS) return diagnostic;
  return diagnostic.slice(0, MAX_ERROR_DIAGNOSTIC_CHARACTERS - TRUNCATION_NOTICE.length) + TRUNCATION_NOTICE;
}

/** Format values escaping the isolated runner without trusting their accessors or conversion hooks. */
export function formatThrownValue(value: unknown): string {
  let isError = false;
  try {
    isError = value instanceof Error;
  } catch {
    // Revoked proxies and hostile Symbol.hasInstance implementations are non-diagnostic values.
  }

  if (!isError) {
    try {
      return boundDiagnostic(String(value));
    } catch {
      return "[unable to format thrown value]";
    }
  }

  const error = value as Error;
  const nameRead = readStringProperty(error, "name");
  const messageRead = readStringProperty(error, "message");
  const stackRead = readStringProperty(error, "stack");
  const name = nameRead.value || "Error";
  const message = messageRead.unavailable ? "[message unavailable]" : messageRead.value;
  const header = message ? `${name}: ${message}` : name;
  const stack = stackRead.value;

  if (!stack) {
    return boundDiagnostic(stackRead.unavailable ? `${header}\n    [stack unavailable]` : header);
  }

  const newline = stack.indexOf("\n");
  const firstLine = newline === -1 ? stack : stack.slice(0, newline);
  let diagnostic: string;
  if (firstLine === header) {
    diagnostic = stack;
  } else if (firstLine === name || firstLine.startsWith(`${name}:`)) {
    diagnostic = header + (newline === -1 ? "" : stack.slice(newline));
  } else {
    diagnostic = `${header}\n${stack}`;
  }
  return boundDiagnostic(diagnostic);
}
