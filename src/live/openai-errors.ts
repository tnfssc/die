/** Only classify explicit provider codes; never expose raw provider messages or infer account eligibility. */
export function providerFailure(error: unknown, model: string, fallback: string): string {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case "insufficient_quota":
      return (
        "OpenAI reports insufficient quota for " + model + ". Check API billing and limits; no model was substituted."
      );
    case "rate_limit_exceeded":
      return "OpenAI reports a rate limit for " + model + ". Retry later; no model was substituted.";
    case "model_not_found":
      return "OpenAI reports " + model + " unavailable or inaccessible to this API key; no model was substituted.";
    case "invalid_api_key":
      return "OpenAI rejected the API key for " + model + ". Use /login to configure an OpenAI API key.";
    default:
      return fallback;
  }
}
