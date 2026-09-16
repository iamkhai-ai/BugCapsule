import * as z from 'zod'
import { EventBaseSchema } from './common'

export const ConsoleLevelSchema = z.enum(['error', 'warn', 'info', 'debug', 'log'])
export type ConsoleLevel = z.infer<typeof ConsoleLevelSchema>

/**
 * Nguồn của console entry.
 *
 * `extension` dùng để lọc noise từ extension khác (`chrome-extension://`) —
 * rác rất phổ biến trong bug report thật và thường bị nhầm là lỗi của app.
 */
export const ConsoleSourceSchema = z.enum(['page', 'extension', 'unknown'])

export const ConsoleEntrySchema = EventBaseSchema.extend({
  level: ConsoleLevelSchema,
  message: z.string(),
  stack: z.string().optional(),
  /**
   * Argument đã được producer serialize thành chuỗi, kèm depth-limit,
   * size-limit, cycle-safe và redaction. Format chỉ lưu chuỗi để không phải
   * định nghĩa một ngôn ngữ tuần tự hoá object.
   */
  args: z.array(z.string()).optional(),
  source: ConsoleSourceSchema,
})
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>

export const ConsoleFileSchema = z.object({
  entries: z.array(ConsoleEntrySchema),
})
export type ConsoleFile = z.infer<typeof ConsoleFileSchema>
