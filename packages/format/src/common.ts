import * as z from 'zod'

/**
 * Giá trị thay thế cho mọi dữ liệu đã bị redaction engine loại bỏ.
 * Xuất hiện trong capsule ở dạng chuỗi literal này — không bao giờ là giá trị gốc.
 */
export const REDACTED = '<redacted>'

/** `formatVersion` là semver đầy đủ MAJOR.MINOR.PATCH (spec §22). */
export const FormatVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'formatVersion phải là semver MAJOR.MINOR.PATCH')

/** Timestamp tuyệt đối, ISO 8601 UTC, luôn kết thúc bằng `Z` (spec §3.2). */
export const IsoTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
    'timestamp phải là ISO 8601 UTC kết thúc bằng Z',
  )

/**
 * Tham chiếu URL.
 *
 * `query` giữ **tên và value** của query parameter, nhưng value của những key
 * nằm trong denylist đã bị thay bằng `REDACTED` từ trước khi rời page context.
 * Nhờ vậy `?tab=settings` vẫn là signal diff được, còn `?token=...` thì không.
 */
export const UrlRefSchema = z.object({
  origin: z.string(),
  pathname: z.string(),
  query: z.record(z.string(), z.string()),
})
export type UrlRef = z.infer<typeof UrlRefSchema>

/**
 * Field chung của mọi event trong capsule.
 *
 * - `docId` phân biệt các document sau hard navigation. Không có nó thì
 *   `offsetMs` của document cũ và document mới không thể tách rời.
 * - `frameId` cho biết event đến từ iframe nào (`0` = top frame).
 * - `seq` phá thế hoà khi hai event có cùng `offsetMs`, giữ diff deterministic.
 */
export const EventBaseSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
  frameId: z.number().int().nonnegative(),
  offsetMs: z.number().nonnegative(),
  seq: z.number().int().nonnegative(),
})
export type EventBase = z.infer<typeof EventBaseSchema>
