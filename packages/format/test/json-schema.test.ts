import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_REGISTRY, generateJsonSchemas } from '../src/json-schema'

describe('generateJsonSchemas', () => {
  it('sinh được JSON Schema cho mọi schema trong registry', () => {
    const generated = generateJsonSchemas()
    expect(Object.keys(generated).sort()).toEqual(Object.keys(SCHEMA_REGISTRY).sort())
  })

  it('mọi entry đều serializable — không có vòng lặp hay kiểu không biểu diễn được', () => {
    for (const [fileName, schema] of Object.entries(generateJsonSchemas())) {
      expect(() => JSON.stringify(schema), fileName).not.toThrow()
      expect(schema, fileName).toHaveProperty('type', 'object')
    }
  })

  it('manifest schema giữ đúng danh sách field bắt buộc', () => {
    const generated = generateJsonSchemas()
    const manifestSchema = generated['manifest.schema.json'] as { required?: string[] }
    expect(manifestSchema.required).toEqual(
      expect.arrayContaining(['format', 'formatVersion', 'id', 'createdAt', 'source', 'capture']),
    )
  })

  it('không chứa additionalProperties:false — nếu có là tự phá forward compatibility (spec §21)', () => {
    const serialized = JSON.stringify(generateJsonSchemas())
    expect(serialized).not.toContain('"additionalProperties":false')
  })

  it('không lệch với JSON Schema đã commit trong spec/0.1 (chống drift)', () => {
    const generated = generateJsonSchemas()
    for (const [fileName, schema] of Object.entries(generated)) {
      const committedPath = join(process.cwd(), 'spec', '0.1', fileName)
      const committed = readFileSync(committedPath, 'utf8')
      expect(committed, `${fileName} lệch — chạy: pnpm gen:schemas`).toBe(
        JSON.stringify(schema, null, 2) + '\n',
      )
    }
  })
})
