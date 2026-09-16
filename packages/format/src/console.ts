import * as z from 'zod'
import { EventBaseSchema } from './common'

export const ConsoleLevelSchema = z.enum(['error', 'warn', 'info', 'debug', 'log'])
export type ConsoleLevel = z.infer<typeof ConsoleLevelSchema>

/**
 * Source of a console entry.
 *
 * `extension` is used to filter noise from other extensions (`chrome-extension://`) —
 * junk that is very common in real bug reports and is often mistaken for an app error.
 */
export const ConsoleSourceSchema = z.enum(['page', 'extension', 'unknown'])

export const ConsoleEntrySchema = EventBaseSchema.extend({
  level: ConsoleLevelSchema,
  message: z.string(),
  stack: z.string().optional(),
  /**
   * Arguments that the producer has serialized into strings, with depth-limit,
   * size-limit, cycle-safety and redaction. The format only stores strings so
   * that it does not have to define an object serialization language.
   */
  args: z.array(z.string()).optional(),
  source: ConsoleSourceSchema,
})
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>

export const ConsoleFileSchema = z.object({
  entries: z.array(ConsoleEntrySchema),
})
export type ConsoleFile = z.infer<typeof ConsoleFileSchema>
