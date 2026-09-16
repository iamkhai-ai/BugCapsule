import * as z from 'zod'

/**
 * Replacement value for all data removed by the redaction engine.
 * Appears in the capsule as this literal string — never the original value.
 */
export const REDACTED = '<redacted>'

/** `formatVersion` is a full semver MAJOR.MINOR.PATCH (spec §22). */
export const FormatVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'formatVersion must be semver MAJOR.MINOR.PATCH')

/** Absolute timestamp, ISO 8601 UTC, always ending in `Z` (spec §3.2). */
export const IsoTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
    'timestamp must be ISO 8601 UTC ending in Z',
  )

/**
 * URL reference.
 *
 * `query` keeps the **name and value** of each query parameter, but the value of
 * any key on the denylist has already been replaced by `REDACTED` before leaving
 * the page context. That way `?tab=settings` stays a diffable signal, while
 * `?token=...` does not.
 */
export const UrlRefSchema = z.object({
  origin: z.string(),
  pathname: z.string(),
  query: z.record(z.string(), z.string()),
})
export type UrlRef = z.infer<typeof UrlRefSchema>

/**
 * Common fields of every event in the capsule.
 *
 * - `docId` distinguishes documents across a hard navigation. Without it,
 *   `offsetMs` values from the old and the new document cannot be told apart.
 * - `frameId` records which iframe the event came from (`0` = top frame).
 * - `seq` breaks ties when two events share the same `offsetMs`, keeping the diff deterministic.
 */
export const EventBaseSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
  frameId: z.number().int().nonnegative(),
  offsetMs: z.number().nonnegative(),
  seq: z.number().int().nonnegative(),
})
export type EventBase = z.infer<typeof EventBaseSchema>
