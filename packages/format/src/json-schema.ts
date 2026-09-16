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
 * Zod là nguồn sự thật duy nhất. JSON Schema được **sinh ra** từ đây bằng
 * `z.toJSONSchema()` và commit vào `spec/0.1/` để third party dùng.
 *
 * Nhờ vậy TypeScript types, validator và JSON Schema không thể lệch nhau:
 * chúng cùng đọc từ một định nghĩa.
 *
 * Không dùng `z.date()`, `z.transform()`, `z.custom()` hay bất kỳ kiểu nào
 * `z.toJSONSchema` không biểu diễn được, vì như vậy JSON Schema sẽ mất thông
 * tin và third-party implementer không còn contract để bám vào.
 *
 * Danh sách này khớp đúng bộ file trong spec §24.
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
 * zod phát `additionalProperties: false` cho mọi `z.object()`. Điều đó **mâu
 * thuẫn trực tiếp với spec §21**: reader MUST ignore field không nhận biết, nên
 * một capsule do version tương lai tạo ra vẫn phải validate được.
 *
 * Ta nới thành `true` trong JSON Schema công bố. Việc kiểm tra chặt là nghĩa vụ
 * của *producer* (xem schema strict riêng trong validator), còn contract công
 * bố phải permissive — nếu không, chính spec tự phá forward compatibility.
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
