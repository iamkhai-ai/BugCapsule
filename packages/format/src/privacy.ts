import * as z from 'zod'

/**
 * Capture configuration that was in effect when the capsule was created.
 *
 * This is an honest record: if `requestBodies` is `false`, a consumer MUST understand
 * that the body was never read at all, not that it was "read and then deleted".
 */
export const PrivacyPolicySchema = z.object({
  queryValues: z.boolean(),
  requestBodies: z.boolean(),
  responseBodies: z.boolean(),
  /**
   * Shape (type tree) of the request/response body, containing no values.
   * Defaults to `true` — shape is not PII, and it is the source of most
   * diff signals (type-change, nullability-change, presence-change).
   */
  bodyShapes: z.boolean(),
  storageValues: z.boolean(),
  consoleVerbose: z.boolean(),
})
export type PrivacyPolicy = z.infer<typeof PrivacyPolicySchema>

/**
 * Names of the fields that were removed. **Names only, never values.**
 *
 * Header/query key names are not secrets, and "was the auth header sent?" is
 * a real debugging question. Counting without naming is not enough.
 */
export const RemovedFieldsSchema = z.object({
  headers: z.array(z.string()),
  queryKeys: z.array(z.string()),
  bodyPaths: z.array(z.string()),
  storageKeys: z.array(z.string()),
})
export type RemovedFields = z.infer<typeof RemovedFieldsSchema>

export const RedactionSummarySchema = z.object({
  applied: z.boolean(),
  byRule: z
    .array(
      z.object({
        rule: z.string().min(1),
        count: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  removedFields: RemovedFieldsSchema,
})
export type RedactionSummary = z.infer<typeof RedactionSummarySchema>

export const PrivacySchema = z.object({
  policy: PrivacyPolicySchema,
  redaction: RedactionSummarySchema,
})
export type Privacy = z.infer<typeof PrivacySchema>

/**
 * Total number of removed fields. This is a derived function, not a stored
 * field — avoiding two sources of truth that can drift apart.
 */
export function removedFieldCount(privacy: Privacy): number {
  const { headers, queryKeys, bodyPaths, storageKeys } = privacy.redaction.removedFields
  return headers.length + queryKeys.length + bodyPaths.length + storageKeys.length
}
