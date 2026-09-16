import * as z from 'zod'
import { EventBaseSchema } from './common'

export const ActionTypeSchema = z.enum(['click', 'input', 'change', 'submit', 'navigation', 'keydown'])
export type ActionType = z.infer<typeof ActionTypeSchema>

/**
 * Selector selection strategy, in decreasing order of priority.
 *
 * `structural` is the last resort because it depends on DOM structure and will
 * break when the app changes layout — consumers should present it with low confidence.
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

/** Metrics about a value, **never the value itself**. */
export const ActionMetadataSchema = z.object({
  valueCaptured: z.boolean(),
  valueLength: z.number().int().nonnegative().optional(),
})

export const ActionEventSchema = EventBaseSchema.extend({
  type: ActionTypeSchema,
  target: ActionTargetSchema.optional(),
  /** Present only with `type: "navigation"`. */
  url: z.string().optional(),
  metadata: ActionMetadataSchema.optional(),
})

export const ActionsFileSchema = z.object({
  events: z.array(ActionEventSchema),
})
export type ActionEvent = z.infer<typeof ActionEventSchema>
export type ActionsFile = z.infer<typeof ActionsFileSchema>
