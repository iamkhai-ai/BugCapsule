import * as z from 'zod'

/**
 * Type của một storage value. **Chỉ type, không value.**
 *
 * Cùng nguyên tắc với `bodyShape`: type không phải PII, nhưng nó cho phép
 * phát hiện `boolean → string` mà không cần đọc giá trị.
 */
export const ValueTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'null',
  'unknown',
])

export const StorageEntrySchema = z.object({
  key: z.string().min(1),
  valueCaptured: z.boolean(),
  value: z.unknown().optional(),
  valueType: ValueTypeSchema.optional(),
})
export type StorageEntry = z.infer<typeof StorageEntrySchema>

export const StateFileSchema = z.object({
  localStorage: z.array(StorageEntrySchema),
  sessionStorage: z.array(StorageEntrySchema),
  /**
   * Tên cookie. **Value cookie không bao giờ được lưu**, và `Set-Cookie`
   * nằm trong hard-deny list.
   *
   * Tên cookie được giữ vì bug auth phổ biến nhất là "session cookie không
   * được set" — đó là thay đổi về *sự hiện diện của key*, không phải value.
   */
  cookieNames: z.array(z.string()),
})
export type StateFile = z.infer<typeof StateFileSchema>

export function valueTypeOf(value: unknown): z.infer<typeof ValueTypeSchema> {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'object'
    default:
      return 'unknown'
  }
}
