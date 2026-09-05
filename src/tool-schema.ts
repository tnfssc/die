import * as z from "zod/mini";

/** Pi accepts plain JSON Schema at runtime, but its TypeScript API still uses
 * TypeBox types. Keep that boundary here; infer/validate arguments with Zod in
 * each execute handler instead of pretending JSON Schema carries static types.
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
