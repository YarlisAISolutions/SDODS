import { z } from 'zod';

/**
 * Tool parameters as a JSON schema the widest range of servers accepts.
 *
 * Two details matter and both bite. Zod's `toJSONSchema` defaults to `io: 'output'`, which marks
 * every field carrying a `.default()` as **required** — telling the model it must invent a value
 * it could have omitted. And the `$schema` key it adds is rejected by some grammar-constrained
 * local servers. Neither belongs in a function definition.
 */
export function toolParameters(
  shape: Parameters<typeof z.object>[0],
  jsonSchema?: Record<string, unknown>,
): Record<string, unknown> {
  const schema = jsonSchema
    ? { ...jsonSchema }
    : (z.toJSONSchema(z.object(shape), { io: 'input' }) as Record<string, unknown>);
  delete schema.$schema;
  return schema;
}
