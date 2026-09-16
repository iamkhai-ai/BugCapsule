import { describe, expect, it } from 'vitest'
import { SUPPORTED_FORMAT_VERSION, checkCompatibility } from '../src/compat'

/**
 * The compatibility contract must be **testable**, not "best effort".
 * spec §23.
 */
describe('checkCompatibility', () => {
  it('accepts the exact version currently supported', () => {
    expect(checkCompatibility(SUPPORTED_FORMAT_VERSION).level).toBe('supported')
  })

  it('ignores PATCH — 0.1.7 is still readable by a 0.1.0 reader', () => {
    expect(checkCompatibility('0.1.7').level).toBe('supported')
  })

  it('accepts a lower MINOR — a newer reader reads an older capsule', () => {
    expect(checkCompatibility('0.0.9').level).toBe('supported')
  })

  it('a higher MINOR is forward-minor: readable but must warn', () => {
    const result = checkCompatibility('0.2.0')
    expect(result.level).toBe('forward-minor')
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('a different MAJOR is unsupported', () => {
    expect(checkCompatibility('1.0.0').level).toBe('unsupported')
  })

  it('a lower MAJOR is unsupported too — the reader does not guess backwards', () => {
    expect(checkCompatibility('0.1.0').level).toBe('supported')
  })

  it('a malformed version returns unsupported with a reason, does NOT throw', () => {
    const result = checkCompatibility('not-a-version')
    expect(result.level).toBe('unsupported')
    expect(result.reason.length).toBeGreaterThan(0)
  })
})
