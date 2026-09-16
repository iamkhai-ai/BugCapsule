import * as z from 'zod'
import { EventBaseSchema, UrlRefSchema } from './common'
import { BodyShapeSchema } from './shape'

export const ResourceTypeSchema = z.enum(['fetch', 'xhr'])

/**
 * Why a body is absent from the capsule.
 *
 * `disabled` means the producer never read the body at all — quite different
 * from "read and then deleted". A consumer MUST distinguish these two cases.
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
  /** Any JSON value. Only present when the user has enabled body capture. */
  value: z.unknown(),
})

export const CapturedBodySchema = z.object({
  contentType: z.string().optional(),
  bodyCaptured: z.boolean(),
  body: BodyPayloadSchema.optional(),
  /**
   * Shape of the body — **captured by default** because shape is not PII.
   * This is the source of type-change / nullability-change / presence-change.
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
