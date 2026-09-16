import { describe, expect, it } from 'vitest'
import { NetworkFileSchema } from '../src/network'

const request = {
  id: 'req_01',
  docId: 'doc_1',
  frameId: 0,
  offsetMs: 5102,
  seq: 4,
  method: 'POST',
  url: {
    origin: 'https://api.example.com',
    pathname: '/api/checkout',
    query: { tab: 'payment', token: '<redacted>' },
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
  response: {
    contentType: 'application/json',
    bodyCaptured: false,
    omissionReason: 'disabled',
  },
}

const file = { requests: [request] }

describe('NetworkFileSchema', () => {
  it('accepts a valid record with a bodyShape and bodyCaptured=false', () => {
    expect(NetworkFileSchema.safeParse(file).success).toBe(true)
  })

  it('requires docId and frameId — without them the timeline cannot be reconstructed (R1)', () => {
    const { docId: _docId, ...withoutDocId } = request
    expect(NetworkFileSchema.safeParse({ requests: [withoutDocId] }).success).toBe(false)

    const { frameId: _frameId, ...withoutFrameId } = request
    expect(NetworkFileSchema.safeParse({ requests: [withoutFrameId] }).success).toBe(false)
  })

  it('requires seq so event order is deterministic when offsetMs collides', () => {
    const { seq: _seq, ...withoutSeq } = request
    expect(NetworkFileSchema.safeParse({ requests: [withoutSeq] }).success).toBe(false)
  })

  it('keeps non-sensitive query values and accepts the <redacted> marker (R4)', () => {
    const parsed = NetworkFileSchema.parse(file)
    expect(parsed.requests[0]?.url.query).toEqual({ tab: 'payment', token: '<redacted>' })
  })

  it('requires bodyCaptured on both sides — no ambiguity allowed', () => {
    const { bodyCaptured: _bodyCaptured, ...request2 } = request.request
    expect(
      NetworkFileSchema.safeParse({ requests: [{ ...request, request: request2 }] }).success,
    ).toBe(false)
  })

  it('rejects an omissionReason that is not in the list', () => {
    const bad = {
      requests: [{ ...request, response: { ...request.response, omissionReason: 'because' } }],
    }
    expect(NetworkFileSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a resourceType outside fetch/xhr', () => {
    expect(
      NetworkFileSchema.safeParse({ requests: [{ ...request, resourceType: 'websocket' }] }).success,
    ).toBe(false)
  })
})
