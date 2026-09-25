export const T3_MCP_URL_ENV = "T3_MCP_URL";
export const T3_MCP_BEARER_ENV = "T3_MCP_BEARER_TOKEN";

/** Copy an environment for model-directed code without delegation credentials. */
export function scrubT3BridgeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed = { ...env };
  delete scrubbed[T3_MCP_URL_ENV];
  delete scrubbed[T3_MCP_BEARER_ENV];
  return scrubbed;
}
