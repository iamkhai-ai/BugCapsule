import * as z from 'zod'

/**
 * Môi trường nơi bug xảy ra.
 *
 * Cố ý **không** fingerprint thiết bị: không GPU, không font list, không
 * hardware ID, không IP. Những thứ đó vừa không cần cho việc reproduce, vừa
 * biến capsule thành một dấu vết nhận dạng.
 */
export const EnvironmentSchema = z.object({
  browser: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  os: z.object({
    name: z.string().min(1),
    version: z.string().optional(),
  }),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    devicePixelRatio: z.number().positive(),
  }),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  network: z.object({ online: z.boolean() }).optional(),
  document: z.object({ visibilityState: z.string() }).optional(),
  /**
   * Định danh build/deploy nếu app tự expose (`<meta name="build">`,
   * `window.__BUILD_ID__`, ...). Rất rẻ và trả lời câu hỏi "bug này ở deploy nào".
   */
  build: z.string().optional(),
})
export type Environment = z.infer<typeof EnvironmentSchema>
