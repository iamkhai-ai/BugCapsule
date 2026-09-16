import * as z from 'zod'

/**
 * The environment where the bug occurred.
 *
 * Deliberately **not** a device fingerprint: no GPU, no font list, no hardware
 * ID, no IP. Those are neither needed to reproduce the bug nor worth turning the
 * capsule into an identifying trace.
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
   * Build/deploy identifier if the app exposes one (`<meta name="build">`,
   * `window.__BUILD_ID__`, ...). Very cheap, and it answers "which deploy is this bug on".
   */
  build: z.string().optional(),
})
export type Environment = z.infer<typeof EnvironmentSchema>
