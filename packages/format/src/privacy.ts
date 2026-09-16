import * as z from 'zod'

/**
 * Cấu hình capture đã dùng khi tạo capsule.
 *
 * Đây là bản ghi trung thực: nếu `requestBodies` là `false`, consumer MUST
 * hiểu rằng body không hề được đọc, chứ không phải "đã đọc rồi xoá".
 */
export const PrivacyPolicySchema = z.object({
  queryValues: z.boolean(),
  requestBodies: z.boolean(),
  responseBodies: z.boolean(),
  /**
   * Shape (cây type) của request/response body, không chứa value.
   * Mặc định `true` — shape không phải PII, và nó là nguồn của hầu hết
   * signal diff (type-change, nullability-change, presence-change).
   */
  bodyShapes: z.boolean(),
  storageValues: z.boolean(),
  consoleVerbose: z.boolean(),
})
export type PrivacyPolicy = z.infer<typeof PrivacyPolicySchema>

/**
 * Tên của những field đã bị loại bỏ. **Chỉ tên, không bao giờ value.**
 *
 * Tên header/query key không phải secret, và "auth header có được gửi không"
 * là câu hỏi debug thật. Đếm số lượng mà không nêu tên là không đủ.
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
 * Tổng số field đã bị loại bỏ. Đây là hàm dẫn xuất chứ không phải field lưu
 * trữ — tránh hai nguồn sự thật có thể lệch nhau.
 */
export function removedFieldCount(privacy: Privacy): number {
  const { headers, queryKeys, bodyPaths, storageKeys } = privacy.redaction.removedFields
  return headers.length + queryKeys.length + bodyPaths.length + storageKeys.length
}
