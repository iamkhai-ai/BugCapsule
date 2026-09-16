import * as z from 'zod'
import { FormatVersionSchema, IsoTimestampSchema, UrlRefSchema } from './common'

/** Producer of the capsule. Unconstrained — third parties are encouraged. */
export const SourceSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
})
export type Source = z.infer<typeof SourceSchema>

export const CaptureWindowSchema = z.object({
  startedAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema,
  durationMs: z.number().nonnegative(),
})
export type CaptureWindow = z.infer<typeof CaptureWindowSchema>

/**
 * Role of the capsule in a comparison.
 *
 * Optional so that a minimal capsule (spec §29) stays valid. A reader MUST treat
 * a missing field as `"unknown"`.
 */
export const CapsuleRoleSchema = z.enum(['working', 'broken', 'unknown'])
export type CapsuleRole = z.infer<typeof CapsuleRoleSchema>

/**
 * Map of logical name → entry path inside the archive.
 *
 * Every value MUST be a relative path, must not contain `..`, must not start
 * with `/`, and MUST point to an entry contained in that same archive (spec §26).
 */
export const ManifestFilesSchema = z.object({
  environment: z.string().optional(),
  actions: z.string().optional(),
  network: z.string().optional(),
  console: z.string().optional(),
  state: z.string().optional(),
  privacy: z.string().optional(),
  screenshot: z.string().optional(),
})
export type ManifestFiles = z.infer<typeof ManifestFilesSchema>

export const ManifestSchema = z.object({
  format: z.literal('bugcapsule'),
  formatVersion: FormatVersionSchema,
  id: z.string().min(1),
  createdAt: IsoTimestampSchema,
  source: SourceSchema,
  capture: CaptureWindowSchema,
  role: CapsuleRoleSchema.optional(),
  page: UrlRefSchema.optional(),
  files: ManifestFilesSchema.optional(),
  /**
   * Known gaps of the capture session, as short codes
   * (`"workers-not-captured"`, `"missed-before-inject"`, `"sw-restarted"`, ...).
   * Declared honestly so consumers do not hunt for data that does not exist.
   */
  captureGaps: z.array(z.string()).optional(),
})
export type Manifest = z.infer<typeof ManifestSchema>
