import * as z from 'zod'
import { EventBaseSchema } from './common'

export const ActionTypeSchema = z.enum(['click', 'input', 'change', 'submit', 'navigation', 'keydown'])
export type ActionType = z.infer<typeof ActionTypeSchema>

/**
 * Chiến lược chọn selector, theo thứ tự ưu tiên giảm dần.
 *
 * `structural` là phương án cuối vì nó phụ thuộc cấu trúc DOM và sẽ hỏng khi
 * app đổi layout — consumer nên hiển thị nó với độ tin cậy thấp.
 */
export const SelectorStrategySchema = z.enum([
  'testid',
  'id',
  'aria',
  'stable-attribute',
  'structural',
])

export const ActionTargetSchema = z.object({
  tag: z.string().min(1),
  selector: z.string().min(1),
  strategy: SelectorStrategySchema,
  role: z.string().optional(),
  inputType: z.string().optional(),
})

/** Chỉ số đo về value, **không bao giờ là value**. */
export const ActionMetadataSchema = z.object({
  valueCaptured: z.boolean(),
  valueLength: z.number().int().nonnegative().optional(),
})

export const ActionEventSchema = EventBaseSchema.extend({
  type: ActionTypeSchema,
  target: ActionTargetSchema.optional(),
  /** Chỉ có với `type: "navigation"`. */
  url: z.string().optional(),
  metadata: ActionMetadataSchema.optional(),
})

export const ActionsFileSchema = z.object({
  events: z.array(ActionEventSchema),
})
export type ActionEvent = z.infer<typeof ActionEventSchema>
export type ActionsFile = z.infer<typeof ActionsFileSchema>
