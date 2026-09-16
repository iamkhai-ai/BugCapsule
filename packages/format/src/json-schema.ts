import * as z from 'zod'
import { ActionsFileSchema } from './actions'
import { ConsoleFileSchema } from './console'
import { EnvironmentSchema } from './environment'
import { ManifestSchema } from './manifest'
import { NetworkFileSchema } from './network'
import { PrivacySchema } from './privacy'
import { StateFileSchema } from './state'

export type JsonSchemaDocument = Record<string, unknown>

/**
 * Zod is the single source of truth. The JSON Schema is **generated** from it
 * by `z.toJSONSchema()` and committed to `spec/0.1/` for third parties to use.
 *
 * This way the TypeScript types, the validator and the JSON Schema cannot
 * drift apart: they all read from a single definition.
 *
 * Do not use `z.date()`, `z.transform()`, `z.custom()` or any type that
 * `z.toJSONSchema` cannot express, since the JSON Schema would then lose
 * information and third-party implementers would have no contract to rely on.
 *
 * This list matches exactly the set of files in spec §24.
 */
export const SCHEMA_REGISTRY: Record<string, z.ZodType> = {
  'manifest.schema.json': ManifestSchema,
  'environment.schema.json': EnvironmentSchema,
  'actions.schema.json': ActionsFileSchema,
  'network.schema.json': NetworkFileSchema,
  'console.schema.json': ConsoleFileSchema,
  'state.schema.json': StateFileSchema,
  'privacy.schema.json': PrivacySchema,
}

/**
 * zod emits `additionalProperties: false` for every `z.object()`. That
 * **directly contradicts spec §21**: a reader MUST ignore fields it does not
 * recognize, so a capsule produced by a future version must still validate.
 *
 * We relax it to `true` in the published JSON Schema. Strict checking is the *producer's*
 * obligation (see the separate strict schema in the validator), while the published contract
 * must be permissive — otherwise the spec itself breaks forward compatibility.
 */
function relaxAdditionalProperties(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(relaxAdditionalProperties)
  if (node === null || typeof node !== 'object') return node

  const source = node as Record<string, unknown>
  const relaxed: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(source)) {
    if (key === 'additionalProperties' && value === false) {
      relaxed[key] = true
      continue
    }
    relaxed[key] = relaxAdditionalProperties(value)
  }

  return relaxed
}

export function generateJsonSchemas(): Record<string, JsonSchemaDocument> {
  const out: Record<string, JsonSchemaDocument> = {}
  for (const [fileName, schema] of Object.entries(SCHEMA_REGISTRY)) {
    const generated = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: 'output',
    })
    out[fileName] = relaxAdditionalProperties(generated) as JsonSchemaDocument
  }
  return out
}
