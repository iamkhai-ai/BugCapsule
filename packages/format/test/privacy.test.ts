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
  it('chấp nhận privacy block hợp lệ', () => {
    expect(PrivacySchema.safeParse(valid).success).toBe(true)
  })

  it('bắt buộc khai đủ policy — không có default ngầm', () => {
    const { bodyShapes: _bodyShapes, ...incomplete } = valid.policy
    expect(PrivacySchema.safeParse({ ...valid, policy: incomplete }).success).toBe(false)
  })

  it('bắt buộc có removedFields để viewer nêu tên field đã xoá', () => {
    const { removedFields: _removedFields, ...rest } = valid.redaction
    expect(PrivacySchema.safeParse({ ...valid, redaction: rest }).success).toBe(false)
  })

  it('removedFieldCount cộng đúng và là hàm dẫn xuất, không phải field lưu trữ', () => {
    const privacy = PrivacySchema.parse(valid)
    expect(removedFieldCount(privacy)).toBe(4)
    expect(privacy.redaction).not.toHaveProperty('total')
  })

  it('byRule là optional', () => {
    const { byRule: _byRule, ...redaction } = valid.redaction
    expect(PrivacySchema.safeParse({ ...valid, redaction }).success).toBe(true)
  })
})
