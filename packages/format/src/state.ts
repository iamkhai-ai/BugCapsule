import * as z from 'zod'

/**
 * Type of a storage value. **Type only, never the value.**
 *
 * Same principle as `bodyShape`: a type is not PII, but it makes it possible
 * to detect `boolean → string` without reading the value.
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
   * Cookie names. **Cookie values are never stored**, and `Set-Cookie`
   * is on the hard-deny list.
   *
   * Cookie names are kept because the most common auth bug is "the session cookie
   * was not set" — that is a change in the *presence of the key*, not in the value.
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
