import * as z from 'zod'
import { EventBaseSchema, UrlRefSchema } from './common'
import { BodyShapeSchema } from './shape'

export const ResourceTypeSchema = z.enum(['fetch', 'xhr'])

/**
 * Lý do một body không có trong capsule.
 *
 * `disabled` nghĩa là producer chưa bao giờ đọc body — khác hẳn với "đã đọc
 * rồi xoá". Consumer MUST phân biệt hai trường hợp này.
 */
export const BodyOmissionReasonSchema = z.enum([
  'disabled',
  'sensitive',
  'unsupported',
  'size-limit',
  'capture-failed',
])

export const BodyPayloadSchema = z.object({
  type: z.enum(['json', 'text']),
  /** Bất kỳ JSON value nào. Chỉ xuất hiện khi người dùng bật capture body. */
  value: z.unknown(),
})

export const CapturedBodySchema = z.object({
  contentType: z.string().optional(),
  bodyCaptured: z.boolean(),
  body: BodyPayloadSchema.optional(),
  /**
   * Shape của body — **mặc định được capture** vì shape không phải PII.
   * Đây là nguồn của type-change / nullability-change / presence-change.
   */
  bodyShape: BodyShapeSchema.optional(),
  omissionReason: BodyOmissionReasonSchema.optional(),
})
export type CapturedBody = z.infer<typeof CapturedBodySchema>

export const NetworkRequestSchema = EventBaseSchema.extend({
  method: z.string().min(1),
  url: UrlRefSchema,
  resourceType: ResourceTypeSchema,
  status: z.number().int(),
  durationMs: z.number().nonnegative(),
  request: CapturedBodySchema,
  response: CapturedBodySchema,
})
export type NetworkRequest = z.infer<typeof NetworkRequestSchema>

export const NetworkFileSchema = z.object({
  requests: z.array(NetworkRequestSchema),
})
export type NetworkFile = z.infer<typeof NetworkFileSchema>
