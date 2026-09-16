import { describe, expect, it } from 'vitest'
import { ManifestSchema } from '../src/manifest'

/** The exact minimal capsule from spec §29 — must always be valid. */
const minimal = {
  format: 'bugcapsule',
  formatVersion: '0.1.0',
  id: 'example',
  createdAt: '2026-09-16T00:00:00Z',
  source: { name: 'example-tool', version: '1.0.0' },
  capture: {
    startedAt: '2026-09-16T00:00:00Z',
    endedAt: '2026-09-16T00:00:01Z',
    durationMs: 1000,
  },
}

describe('ManifestSchema', () => {
  it('accepts the minimal capsule (spec §29)', () => {
    expect(ManifestSchema.safeParse(minimal).success).toBe(true)
  })

  it('skips unknown fields instead of crashing (forward compatibility, spec §21)', () => {
    const parsed = ManifestSchema.parse({ ...minimal, futureField: { x: 1 }, gpu: {} })
    expect(parsed).not.toHaveProperty('futureField')
    expect(parsed).not.toHaveProperty('gpu')
  })

  it('rejects a formatVersion that is not a full semver', () => {
    expect(ManifestSchema.safeParse({ ...minimal, formatVersion: '0.1' }).success).toBe(false)
  })

  it('rejects a timestamp that does not end with Z (spec §3.1)', () => {
    const result = ManifestSchema.safeParse({ ...minimal, createdAt: '2026-09-16T00:00:00+07:00' })
    expect(result.success).toBe(false)
  })

  it('rejects a format other than "bugcapsule"', () => {
    expect(ManifestSchema.safeParse({ ...minimal, format: 'har' }).success).toBe(false)
  })

  it('fails when a required field is missing', () => {
    const { capture: _capture, ...withoutCapture } = minimal
    expect(ManifestSchema.safeParse(withoutCapture).success).toBe(false)
  })

  it('role is optional but only accepts the 3 defined values', () => {
    expect(ManifestSchema.safeParse({ ...minimal, role: 'broken' }).success).toBe(true)
    expect(ManifestSchema.safeParse({ ...minimal, role: 'flaky' }).success).toBe(false)
  })

  it('page keeps non-sensitive query values and preserves the redacted marker', () => {
    const parsed = ManifestSchema.parse({
      ...minimal,
      page: {
        origin: 'https://example.com',
        pathname: '/reset-password',
        query: { tab: 'settings', token: '<redacted>' },
      },
    })
    expect(parsed.page?.query).toEqual({ tab: 'settings', token: '<redacted>' })
  })
})
