/** Transport metadata only. Never include exception text, response bodies, headers, URLs or keys. */
export function connectionFailure(event: unknown): string {
  const e = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const nested = e.error && typeof e.error === "object" ? (e.error as Record<string, unknown>) : {};
  const status = [e.status, e.statusCode, nested.status, nested.statusCode].find(
    (value) => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599,
  );
  switch (status) {
    case 401:
      return "OpenAI WebSocket authentication rejected (HTTP 401). Check the configured API key.";
    case 403:
      return "OpenAI WebSocket access denied (HTTP 403). Check project and model access.";
    case 404:
      return "OpenAI WebSocket endpoint or model unavailable (HTTP 404).";
    case 429:
      return "OpenAI WebSocket rate limited (HTTP 429). Retry later.";
    default:
      if (typeof status === "number")
        return status >= 500
          ? "OpenAI WebSocket server error (HTTP " + status + "). Retry later."
          : "OpenAI WebSocket upgrade rejected (HTTP " + status + ").";
  }
  // Bun 1.4.2 emits Expected 101 status code on a rejected handshake, but does not expose
  // the response's actual status. Do not guess 401, model access or billing from this.
  const message = typeof e.message === "string" ? e.message : typeof nested.message === "string" ? nested.message : "";
  if (message.includes("Expected 101 status code"))
    return "OpenAI WebSocket upgrade rejected (HTTP status unavailable). Check key, model access, rate limits or network; see provider dashboard.";
  return "OpenAI WebSocket connection failed (network or upgrade error; HTTP status unavailable).";
}
