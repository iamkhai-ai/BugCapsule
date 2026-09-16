import { describe, expect, it } from 'vitest'
import { SUPPORTED_FORMAT_VERSION, checkCompatibility } from '../src/compat'

/**
 * Hợp đồng tương thích phải **test được**, không phải "best effort".
 * spec §23.
 */
describe('checkCompatibility', () => {
  it('chấp nhận đúng version đang hỗ trợ', () => {
    expect(checkCompatibility(SUPPORTED_FORMAT_VERSION).level).toBe('supported')
  })

  it('bỏ qua PATCH — 0.1.7 vẫn đọc được bởi reader 0.1.0', () => {
    expect(checkCompatibility('0.1.7').level).toBe('supported')
  })

  it('chấp nhận MINOR thấp hơn — reader mới đọc capsule cũ', () => {
    expect(checkCompatibility('0.0.9').level).toBe('supported')
  })

  it('MINOR cao hơn là forward-minor: đọc được nhưng phải cảnh báo', () => {
    const result = checkCompatibility('0.2.0')
    expect(result.level).toBe('forward-minor')
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('MAJOR khác là unsupported', () => {
    expect(checkCompatibility('1.0.0').level).toBe('unsupported')
  })

  it('MAJOR thấp hơn cũng là unsupported — reader không đoán ngược', () => {
    expect(checkCompatibility('0.1.0').level).toBe('supported')
  })

  it('version hỏng trả unsupported kèm lý do, KHÔNG throw', () => {
    const result = checkCompatibility('not-a-version')
    expect(result.level).toBe('unsupported')
    expect(result.reason.length).toBeGreaterThan(0)
  })
})
