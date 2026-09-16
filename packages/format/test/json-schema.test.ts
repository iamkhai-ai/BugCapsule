import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_REGISTRY, generateJsonSchemas } from '../src/json-schema'

describe('generateJsonSchemas', () => {
  it('generates a JSON Schema for every schema in the registry', () => {
    const generated = generateJsonSchemas()
    expect(Object.keys(generated).sort()).toEqual(Object.keys(SCHEMA_REGISTRY).sort())
  })

  it('every entry is serializable — no cycles or unrepresentable types', () => {
    for (const [fileName, schema] of Object.entries(generateJsonSchemas())) {
      expect(() => JSON.stringify(schema), fileName).not.toThrow()
      expect(schema, fileName).toHaveProperty('type', 'object')
    }
  })

  it('the manifest schema keeps the exact list of required fields', () => {
    const generated = generateJsonSchemas()
    const manifestSchema = generated['manifest.schema.json'] as { required?: string[] }
    expect(manifestSchema.required).toEqual(
      expect.arrayContaining(['format', 'formatVersion', 'id', 'createdAt', 'source', 'capture']),
    )
  })

  it('contains no additionalProperties:false — having one would break forward compatibility (spec §21)', () => {
    const serialized = JSON.stringify(generateJsonSchemas())
    expect(serialized).not.toContain('"additionalProperties":false')
  })

  it('does not drift from the JSON Schemas committed under spec/0.1 (anti-drift)', () => {
    const generated = generateJsonSchemas()
    for (const [fileName, schema] of Object.entries(generated)) {
      const committedPath = join(process.cwd(), 'spec', '0.1', fileName)
      const committed = readFileSync(committedPath, 'utf8')
      expect(committed, `${fileName} drifted — run: pnpm gen:schemas`).toBe(
        JSON.stringify(schema, null, 2) + '\n',
      )
    }
  })
})
