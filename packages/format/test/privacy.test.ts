import { describe, expect, it } from 'vitest'
import { PrivacySchema, removedFieldCount } from '../src/privacy'

const valid = {
  policy: {
    queryValues: false,
    requestBodies: false,
    responseBodies: false,
    bodyShapes: true,
    storageValues: false,
    consoleVerbose: false,
  },
  redaction: {
    applied: true,
    byRule: [{ rule: 'auth-header', count: 4 }],
    removedFields: {
      headers: ['authorization', 'cookie'],
      queryKeys: ['token'],
      bodyPaths: ['$.password'],
      storageKeys: [],
    },
  },
}

describe('PrivacySchema', () => {
  it('accepts a valid privacy block', () => {
    expect(PrivacySchema.safeParse(valid).success).toBe(true)
  })

  it('requires a fully declared policy — no implicit defaults', () => {
    const { bodyShapes: _bodyShapes, ...incomplete } = valid.policy
    expect(PrivacySchema.safeParse({ ...valid, policy: incomplete }).success).toBe(false)
  })

  it('requires removedFields so the viewer can name the fields that were removed', () => {
    const { removedFields: _removedFields, ...rest } = valid.redaction
    expect(PrivacySchema.safeParse({ ...valid, redaction: rest }).success).toBe(false)
  })

  it('removedFieldCount sums correctly and is a derived function, not a stored field', () => {
    const privacy = PrivacySchema.parse(valid)
    expect(removedFieldCount(privacy)).toBe(4)
    expect(privacy.redaction).not.toHaveProperty('total')
  })

  it('byRule is optional', () => {
    const { byRule: _byRule, ...redaction } = valid.redaction
    expect(PrivacySchema.safeParse({ ...valid, redaction }).success).toBe(true)
  })
})
