import type {
  BodyShape,
  CapsuleArchive,
  Environment,
  NetworkRequest,
  Privacy,
  StateFile,
} from '@bugcapsule/format'
import { buildCheckoutBroken, buildCheckoutWorking } from '@bugcapsule/fixtures'
import { describe, expect, it } from 'vitest'
import { diffCapsules } from '../src/index'

const privacy: Privacy = {
  policy: {
    queryValues: true,
    requestBodies: false,
    responseBodies: false,
    bodyShapes: true,
    storageValues: true,
    consoleVerbose: false,
  },
  redaction: {
    applied: true,
    removedFields: { headers: [], queryKeys: [], bodyPaths: [], storageKeys: [] },
  },
}

function capsule(parts: Partial<CapsuleArchive> & { id?: string } = {}): CapsuleArchive {
  const { id = 'inline', ...rest } = parts
  return {
    manifest: {
      format: 'bugcapsule',
      formatVersion: '0.1.0',
      id,
      createdAt: '2026-09-16T09:00:00Z',
      source: { name: 'test', version: '0.1.0' },
      capture: {
        startedAt: '2026-09-16T08:59:30Z',
        endedAt: '2026-09-16T09:00:00Z',
        durationMs: 30000,
      },
    },
    ...rest,
  }
}

function request(opts: {
  pathname: string
  status?: number
  durationMs?: number
  query?: Record<string, string>
  responseShape?: BodyShape
  offsetMs?: number
}): NetworkRequest {
  const shape = opts.responseShape ?? { type: 'object', properties: { ok: { type: 'boolean' } } }
  return {
    id: `req_${opts.pathname}`,
    docId: 'doc_1',
    frameId: 0,
    offsetMs: opts.offsetMs ?? 100,
    seq: 1,
    method: 'POST',
    url: {
      origin: 'https://api.example.com',
      pathname: opts.pathname,
      query: opts.query ?? {},
    },
    resourceType: 'fetch',
    status: opts.status ?? 200,
    durationMs: opts.durationMs ?? 100,
    request: { bodyCaptured: false, omissionReason: 'disabled' },
    response: {
      contentType: 'application/json',
      bodyCaptured: false,
      omissionReason: 'disabled',
      bodyShape: shape,
    },
  }
}

function networkOf(...requests: NetworkRequest[]): { requests: NetworkRequest[] } {
  return { requests }
}

describe('diffCapsules — checkout fixture pair', () => {
  const diff = diffCapsules(buildCheckoutWorking(), buildCheckoutBroken())

  it('reports status-class-change on POST /api/checkout', () => {
    const signal = diff.signals.find((s) => s.kind === 'status-class-change')
    expect(signal?.label).toBe('POST /api/checkout')
    expect(signal?.before).toBe(201)
    expect(signal?.after).toBe(500)
    expect(signal?.weight).toBe(3)
  })

  it('reports presence-change for every field that disappears and appears', () => {
    const removed = diff.signals.find(
      (s) => s.kind === 'presence-change' && s.field === 'response.orderId',
    )
    expect(removed?.before).toBe('string')
    expect(removed?.after).toBeUndefined()

    const added = diff.signals.find(
      (s) => s.kind === 'presence-change' && s.field === 'response.error',
    )
    expect(added?.after).toBe('string')
  })

  it('reports console-error-appeared', () => {
    const signal = diff.signals.find((s) => s.kind === 'console-error-appeared')
    expect(signal?.weight).toBe(3)
    expect(signal?.after).toContain('500 Internal Server Error')
  })

  it('reports request-only-in-broken for the retry that adds a query key', () => {
    const signal = diff.signals.find((s) => s.kind === 'request-only-in-broken')
    expect(signal?.matchKey).toContain('retry')
  })

  it('a boolean feature flag flipped false→true is a SHOWN signal, not hidden', () => {
    const signal = diff.signals.find(
      (s) => s.kind === 'state-value-changed' && s.field === 'localStorage.feature_new_checkout',
    )
    expect(signal?.before).toBe(false)
    expect(signal?.after).toBe(true)
    expect(signal?.defaultVisibility).toBe('shown')
  })

  it('sorts by weight descending, never increasing anywhere', () => {
    const weights = diff.signals.map((s) => s.weight)
    const sorted = [...weights].sort((a, b) => b - a)
    expect(weights).toEqual(sorted)
  })

  it('the root cause comes before EVERY same-weight consequence, not just one of them', () => {
    const rootCause = diff.signals.findIndex((s) => s.kind === 'status-class-change')
    expect(rootCause).toBeGreaterThanOrEqual(0)

    const symptomIndices = diff.signals
      .map((signal, index) => ({ kind: signal.kind, index }))
      .filter(({ kind }) => kind === 'presence-change')
      .map(({ index }) => index)

    expect(symptomIndices.length).toBeGreaterThan(0)
    for (const index of symptomIndices) {
      expect(rootCause, `status-class-change must come before presence-change at index ${index}`).toBeLessThan(index)
    }
  })

  it('every signal carries a reason and a confidence — trust budget', () => {
    for (const signal of diff.signals) {
      expect(signal.reason.length, signal.id).toBeGreaterThan(0)
      expect(['high', 'medium', 'low']).toContain(signal.confidence)
    }
  })
})

describe('diffCapsules — classification rules', () => {
  it('string → string|null is a nullability-change, not a type-change', () => {
    const before = capsule({
      network: networkOf(request({ pathname: '/a', responseShape: { type: 'object', properties: { a: { type: 'string' } } } })),
    })
    const after = capsule({
      network: networkOf(
        request({
          pathname: '/a',
          responseShape: {
            type: 'object',
            properties: { a: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
          },
        }),
      ),
    })

    const diff = diffCapsules(before, after)
    expect(diff.signals.find((s) => s.field === 'response.a')?.kind).toBe('nullability-change')
  })

  it('number → string is a type-change', () => {
    const before = capsule({
      network: networkOf(request({ pathname: '/a', responseShape: { type: 'object', properties: { a: { type: 'number' } } } })),
    })
    const after = capsule({
      network: networkOf(request({ pathname: '/a', responseShape: { type: 'object', properties: { a: { type: 'string' } } } })),
    })
    expect(diffCapsules(before, after).signals.find((s) => s.field === 'response.a')?.kind).toBe(
      'type-change',
    )
  })

  it('a small duration difference is counted as noise, NOT emitted as a signal', () => {
    const before = capsule({ network: networkOf(request({ pathname: '/a', durationMs: 100 })) })
    const after = capsule({ network: networkOf(request({ pathname: '/a', durationMs: 150 })) })

    const diff = diffCapsules(before, after)
    expect(diff.signals.some((s) => s.kind === 'duration-outlier')).toBe(false)
    expect(diff.dropped).toContainEqual({ kind: 'duration-noise', count: 1 })
  })

  it('a large duration difference becomes a duration-outlier', () => {
    const before = capsule({ network: networkOf(request({ pathname: '/a', durationMs: 100 })) })
    const after = capsule({ network: networkOf(request({ pathname: '/a', durationMs: 2000 })) })
    expect(diffCapsules(before, after).signals.some((s) => s.kind === 'duration-outlier')).toBe(true)
  })

  it('a string value drift is hidden rather than dropped silently', () => {
    const stateOf = (value: string): StateFile => ({
      localStorage: [{ key: 'sessionToken', valueCaptured: true, value, valueType: 'string' }],
      sessionStorage: [],
      cookieNames: [],
    })
    const diff = diffCapsules(capsule({ state: stateOf('aaa') }), capsule({ state: stateOf('bbb') }))

    expect(diff.signals.some((s) => s.kind === 'state-value-changed')).toBe(false)
    const hidden = diff.hidden.find((s) => s.kind === 'state-value-changed')
    expect(hidden?.defaultVisibility).toBe('hidden')
    expect(hidden?.before).toBe('aaa')
  })

  it('a build change is a heavy signal, other environment fields are just information', () => {
    const envOf = (build: string, locale: string): Environment => ({
      browser: { name: 'Chrome', version: '128' },
      os: { name: 'Windows' },
      viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
      build,
      locale,
    })

    const buildDiff = diffCapsules(
      capsule({ environment: envOf('build-a', 'en-US') }),
      capsule({ environment: envOf('build-b', 'en-US') }),
    )
    expect(buildDiff.signals.find((s) => s.field === 'build')?.weight).toBe(3)

    const localeDiff = diffCapsules(
      capsule({ environment: envOf('build-a', 'en-US') }),
      capsule({ environment: envOf('build-a', 'vi-VN') }),
    )
    expect(localeDiff.signals.find((s) => s.field === 'locale')?.weight).toBe(1)
  })

  it('two identical capsules produce an empty diff', () => {
    const diff = diffCapsules(buildCheckoutWorking(), buildCheckoutWorking())
    expect(diff.signals).toEqual([])
    expect(diff.hidden).toEqual([])
  })

  it('dropped is always present, even when empty — nothing is ever hidden silently', () => {
    expect(Array.isArray(diffCapsules(buildCheckoutWorking(), buildCheckoutBroken()).dropped)).toBe(true)
  })
})

describe('diffCapsules — dismissal', () => {
  it('a dismissed signal moves to suppressed and leaves the visible list', () => {
    const baseline = buildCheckoutWorking()
    const candidate = buildCheckoutBroken()
    const first = diffCapsules(baseline, candidate)
    const target = first.signals[0]!

    const second = diffCapsules(baseline, candidate, { suppressed: [target.id] })
    expect(second.signals.some((s) => s.id === target.id)).toBe(false)
    expect(second.suppressed).toContainEqual({ id: target.id, reason: 'dismissed by the user' })
    expect(second.suppressedCount).toBe(1)
  })

  it('signal ids are stable across runs — otherwise dismissal is meaningless', () => {
    const a = diffCapsules(buildCheckoutWorking(), buildCheckoutBroken())
    const b = diffCapsules(buildCheckoutWorking(), buildCheckoutBroken())
    expect(a.signals.map((s) => s.id)).toEqual(b.signals.map((s) => s.id))
  })
})
