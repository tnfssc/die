import * as z from "zod/mini";

/** Pi accepts plain JSON Schema at runtime, but its TypeScript API uses TypeBox.
 * Keep that boundary here. Use Zod in each execute handler to infer and check
 * arguments. Do not pretend JSON Schema has static types.
 */
export function toolParameters(schema: z.ZodMiniType) {
  const {
    $schema: _dialect,
    "~standard": _standard,
    ...parameters
  } = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
  });
  return parameters;
}
