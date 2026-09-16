import { describe, expect, it } from 'vitest'
import { ManifestSchema } from '../src/manifest'

/** Đúng capsule tối thiểu trong spec §29 — phải luôn hợp lệ. */
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
  it('chấp nhận capsule tối thiểu (spec §29)', () => {
    expect(ManifestSchema.safeParse(minimal).success).toBe(true)
  })

  it('bỏ qua field lạ thay vì crash (forward compatibility, spec §21)', () => {
    const parsed = ManifestSchema.parse({ ...minimal, futureField: { x: 1 }, gpu: {} })
    expect(parsed).not.toHaveProperty('futureField')
    expect(parsed).not.toHaveProperty('gpu')
  })

  it('từ chối formatVersion không phải semver đầy đủ', () => {
    expect(ManifestSchema.safeParse({ ...minimal, formatVersion: '0.1' }).success).toBe(false)
  })

  it('từ chối timestamp không kết thúc bằng Z (spec §3.1)', () => {
    const result = ManifestSchema.safeParse({ ...minimal, createdAt: '2026-09-16T00:00:00+07:00' })
    expect(result.success).toBe(false)
  })

  it('từ chối format khác "bugcapsule"', () => {
    expect(ManifestSchema.safeParse({ ...minimal, format: 'har' }).success).toBe(false)
  })

  it('thiếu field bắt buộc thì fail', () => {
    const { capture: _capture, ...withoutCapture } = minimal
    expect(ManifestSchema.safeParse(withoutCapture).success).toBe(false)
  })

  it('role là optional nhưng chỉ nhận 3 giá trị đã định nghĩa', () => {
    expect(ManifestSchema.safeParse({ ...minimal, role: 'broken' }).success).toBe(true)
    expect(ManifestSchema.safeParse({ ...minimal, role: 'flaky' }).success).toBe(false)
  })

  it('page giữ query value không nhạy cảm và giữ nguyên nhãn redacted', () => {
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
