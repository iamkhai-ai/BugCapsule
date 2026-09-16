import { describe, expect, it } from 'vitest'
import { REDACTED } from '../src/common'
import { validateCapsule, validateManifest, type CapsuleParts } from '../src/validate'

const minimalManifest = {
  format: 'bugcapsule',
  formatVersion: '0.1.0',
  id: 'example',
  createdAt: '2026-09-16T00:00:00Z',
  source: { name: 'example-tool', version: '1.0.0' },
  capture: {
    startedAt: '2026-09-16T00:00:00Z',
    endedAt: '2026-09-16T00:00:30Z',
    durationMs: 30000,
  },
}

/** Capsule đầy đủ và TRUNG THỰC — mọi test khác chỉ là biến thể của nó. */
function honestCapsule(): CapsuleParts {
  return {
    manifest: minimalManifest,
    network: {
      requests: [
        {
          id: 'req_01',
          docId: 'doc_1',
          frameId: 0,
          offsetMs: 5102,
          seq: 4,
          method: 'POST',
          url: {
            origin: 'https://api.example.com',
            pathname: '/api/checkout',
            query: { tab: 'payment', token: REDACTED },
          },
          resourceType: 'fetch',
          status: 500,
          durationMs: 321,
          request: {
            contentType: 'application/json',
            bodyCaptured: false,
            bodyShape: { type: 'object', properties: { quantity: { type: 'number' } } },
            omissionReason: 'disabled',
          },
          response: { contentType: 'application/json', bodyCaptured: false, omissionReason: 'disabled' },
        },
      ],
    },
    state: {
      localStorage: [{ key: 'feature_new_checkout', valueCaptured: false, valueType: 'boolean' }],
      sessionStorage: [],
      cookieNames: ['session'],
    },
    privacy: {
      policy: {
        queryValues: true,
        requestBodies: false,
        responseBodies: false,
        bodyShapes: true,
        storageValues: false,
        consoleVerbose: false,
      },
      redaction: {
        applied: true,
        removedFields: { headers: ['authorization'], queryKeys: ['token'], bodyPaths: [], storageKeys: [] },
      },
    },
  }
}

describe('validateManifest', () => {
  it('chấp nhận manifest tối thiểu hợp lệ', () => {
    const result = validateManifest(minimalManifest)
    expect(result.ok).toBe(true)
    expect(result.value?.id).toBe('example')
  })

  it('từ chối input không phải object', () => {
    expect(validateManifest(null).ok).toBe(false)
    expect(validateManifest('nope').ok).toBe(false)
  })

  it('mặc định bỏ qua field lạ — forward compatibility (spec §21)', () => {
    const result = validateManifest({ ...minimalManifest, futureField: 1 })
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('strict mode báo field lạ ở cấp gốc — bắt lỗi typo khi TẠO capsule', () => {
    const result = validateManifest({ ...minimalManifest, bugcapsuleTypo: 1 }, { strict: true })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('bugcapsuleTypo')
  })

  it('strict mode báo field lạ lồng nhau bằng đường dẫn có dấu chấm', () => {
    const manifest = { ...minimalManifest, capture: { ...minimalManifest.capture, odd: true } }
    const result = validateManifest(manifest, { strict: true })
    expect(result.issues.map((issue) => issue.path)).toContain('capture.odd')
  })

  it('MAJOR không hỗ trợ thì từ chối, không cố đoán', () => {
    const result = validateManifest({ ...minimalManifest, formatVersion: '1.0.0' })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('unsupported-format-version')
  })

  it('MINOR cao hơn thì đọc được nhưng phải cảnh báo', () => {
    const result = validateManifest({ ...minimalManifest, formatVersion: '0.2.0' })
    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe('validateCapsule', () => {
  it('chấp nhận capsule trung thực', () => {
    const result = validateCapsule(honestCapsule())
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('từ chối khi thiếu manifest', () => {
    expect(validateCapsule({ network: { requests: [] } }).ok).toBe(false)
  })

  it('từ chối capture window ngược thời gian', () => {
    const parts = honestCapsule()
    parts.manifest = {
      ...minimalManifest,
      capture: { ...minimalManifest.capture, endedAt: '2026-09-15T00:00:00Z' },
    }
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('capture-window-invalid')
  })

  it('từ chối input type=password có valueCaptured=true — không có override', () => {
    const parts = honestCapsule()
    parts.actions = {
      events: [
        {
          id: 'act_1',
          docId: 'doc_1',
          frameId: 0,
          offsetMs: 100,
          seq: 1,
          type: 'input',
          target: { tag: 'input', selector: '#pw', strategy: 'id', inputType: 'password' },
          metadata: { valueCaptured: true, valueLength: 12 },
        },
      ],
    }
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('password-value-captured')
  })

  it('từ chối bodyCaptured=false nhưng vẫn có body', () => {
    const parts = honestCapsule()
    const request = (parts.network as { requests: Record<string, unknown>[] }).requests[0]
    request.request = { bodyCaptured: false, body: { type: 'json', value: { quantity: 1 } } }
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('body-present-but-not-captured')
  })
})

/**
 * Đây là phần quan trọng nhất của validator: `privacy.json` là một LỜI TUYÊN
 * BỐ, và validator biến nó thành lời tuyên bố **được kiểm chứng**. Nếu policy
 * nói "không capture body" mà body vẫn có mặt, capsule không hợp lệ.
 */
describe('validateCapsule — kiểm chứng lời tuyên bố privacy', () => {
  function withPolicy(overrides: Record<string, boolean>): CapsuleParts {
    const parts = honestCapsule()
    const privacy = parts.privacy as { policy: Record<string, boolean> }
    privacy.policy = { ...privacy.policy, ...overrides }
    return parts
  }

  it('policy nói không capture request body mà body có mặt thì bất hợp lệ', () => {
    const parts = withPolicy({ requestBodies: false })
    const request = (parts.network as { requests: Record<string, unknown>[] }).requests[0]
    request.request = {
      bodyCaptured: true,
      body: { type: 'json', value: { quantity: 1 } },
    }
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('privacy-claim-violated')
  })

  it('policy nói không capture storage value mà value có mặt thì bất hợp lệ', () => {
    const parts = withPolicy({ storageValues: false })
    const state = parts.state as { localStorage: Record<string, unknown>[] }
    state.localStorage[0] = { key: 'feature_new_checkout', valueCaptured: true, value: true }
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('privacy-claim-violated')
  })

  it('policy nói không capture bodyShape mà bodyShape có mặt thì bất hợp lệ', () => {
    const parts = withPolicy({ bodyShapes: false })
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('privacy-claim-violated')
  })

  it('policy nói không lưu query value mà có value chưa redact thì bất hợp lệ', () => {
    const parts = withPolicy({ queryValues: false })
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('privacy-claim-violated')
  })

  it('cùng policy đó nhưng query đã redact hết thì hợp lệ', () => {
    const parts = withPolicy({ queryValues: false })
    const request = (parts.network as { requests: { url: { query: Record<string, string> } }[] })
      .requests[0]
    request.url.query = { tab: REDACTED, token: REDACTED }
    expect(validateCapsule(parts).ok).toBe(true)
  })
})
