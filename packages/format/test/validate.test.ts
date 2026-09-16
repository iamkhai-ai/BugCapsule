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

/** A complete and HONEST capsule — every other test is just a variation of it. */
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
  it('accepts a valid minimal manifest', () => {
    const result = validateManifest(minimalManifest)
    expect(result.ok).toBe(true)
    expect(result.value?.id).toBe('example')
  })

  it('rejects non-object input', () => {
    expect(validateManifest(null).ok).toBe(false)
    expect(validateManifest('nope').ok).toBe(false)
  })

  it('skips unknown fields by default — forward compatibility (spec §21)', () => {
    const result = validateManifest({ ...minimalManifest, futureField: 1 })
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('strict mode reports unknown root fields — catches typos when CREATING a capsule', () => {
    const result = validateManifest({ ...minimalManifest, bugcapsuleTypo: 1 }, { strict: true })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('bugcapsuleTypo')
  })

  it('strict mode reports nested unknown fields with a dotted path', () => {
    const manifest = { ...minimalManifest, capture: { ...minimalManifest.capture, odd: true } }
    const result = validateManifest(manifest, { strict: true })
    expect(result.issues.map((issue) => issue.path)).toContain('capture.odd')
  })

  it('rejects an unsupported MAJOR instead of trying to guess', () => {
    const result = validateManifest({ ...minimalManifest, formatVersion: '1.0.0' })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('unsupported-format-version')
  })

  it('a higher MINOR is readable but must warn', () => {
    const result = validateManifest({ ...minimalManifest, formatVersion: '0.2.0' })
    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe('validateCapsule', () => {
  it('accepts an honest capsule', () => {
    const result = validateCapsule(honestCapsule())
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('rejects a missing manifest', () => {
    expect(validateCapsule({ network: { requests: [] } }).ok).toBe(false)
  })

  it('rejects a capture window that runs backwards in time', () => {
    const parts = honestCapsule()
    parts.manifest = {
      ...minimalManifest,
      capture: { ...minimalManifest.capture, endedAt: '2026-09-15T00:00:00Z' },
    }
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('capture-window-invalid')
  })

  it('rejects input type=password with valueCaptured=true — there is no override', () => {
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

  it('rejects bodyCaptured=false when a body is still present', () => {
    const parts = honestCapsule()
    const request = (parts.network as { requests: Record<string, unknown>[] }).requests[0]
    request.request = { bodyCaptured: false, body: { type: 'json', value: { quantity: 1 } } }
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('body-present-but-not-captured')
  })
})

/**
 * This is the most important part of the validator: `privacy.json` is a CLAIM,
 * and the validator turns it into a **verified** claim. If the policy says
 * "no body capture" but a body is still present, the capsule is invalid.
 */
describe('validateCapsule — verifying the privacy claim', () => {
  function withPolicy(overrides: Record<string, boolean>): CapsuleParts {
    const parts = honestCapsule()
    const privacy = parts.privacy as { policy: Record<string, boolean> }
    privacy.policy = { ...privacy.policy, ...overrides }
    return parts
  }

  it('invalid when the policy says no request bodies but a body is present', () => {
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

  it('invalid when the policy says no storage values but a value is present', () => {
    const parts = withPolicy({ storageValues: false })
    const state = parts.state as { localStorage: Record<string, unknown>[] }
    state.localStorage[0] = { key: 'feature_new_checkout', valueCaptured: true, value: true }
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('privacy-claim-violated')
  })

  it('invalid when the policy says no body shapes but a body shape is present', () => {
    const parts = withPolicy({ bodyShapes: false })
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('privacy-claim-violated')
  })

  it('invalid when the policy says no query values but an unredacted value is present', () => {
    const parts = withPolicy({ queryValues: false })
    const result = validateCapsule(parts)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('privacy-claim-violated')
  })

  it('valid under that same policy once every query value is redacted', () => {
    const parts = withPolicy({ queryValues: false })
    const request = (parts.network as { requests: { url: { query: Record<string, string> } }[] })
      .requests[0]
    request.url.query = { tab: REDACTED, token: REDACTED }
    expect(validateCapsule(parts).ok).toBe(true)
  })
})
