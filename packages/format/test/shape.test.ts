import { describe, expect, it } from 'vitest'
import {
  BodyShapeSchema,
  canonicalShapeKey,
  unifyBodyShapes,
  valueToBodyShape,
  type BodyShape,
} from '../src/shape'

describe('valueToBodyShape', () => {
  it('infers the type of primitives and null', () => {
    expect(valueToBodyShape('x')).toEqual({ type: 'string' })
    expect(valueToBodyShape(1)).toEqual({ type: 'number' })
    expect(valueToBodyShape(true)).toEqual({ type: 'boolean' })
    expect(valueToBodyShape(null)).toEqual({ type: 'null' })
  })

  it('infers nested objects and sorts keys for determinism', () => {
    expect(valueToBodyShape({ b: 1, a: 'x' })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    })
  })

  it('an empty array yields unknown items, not an empty object', () => {
    expect(valueToBodyShape([])).toEqual({ type: 'array', items: { type: 'unknown' } })
  })

  it('array elements with differing missing keys merge their keys, NOT an anyOf', () => {
    const shape = valueToBodyShape([{ id: 1 }, { id: 2, name: 'b' }])
    expect(shape).toEqual({
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } } },
    })
  })

  it('does NOT retain values — this is the privacy guarantee of the whole format', () => {
    const secret = 'SUPERSECRET_CANARY_12345'
    const serialized = JSON.stringify(valueToBodyShape({ token: secret, nested: { a: secret } }))
    expect(serialized).not.toContain(secret)
  })
})

describe('unifyBodyShapes', () => {
  it('merges arrays with the same item type', () => {
    const unified = unifyBodyShapes([{ type: 'array', items: { type: 'string' } }])
    expect(unified).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('different types produce anyOf, sorted deterministically', () => {
    const a = unifyBodyShapes([{ type: 'string' }, { type: 'number' }])
    const b = unifyBodyShapes([{ type: 'number' }, { type: 'string' }])
    expect(canonicalShapeKey(a)).toBe(canonicalShapeKey(b))
    expect(a).toEqual({ anyOf: [{ type: 'number' }, { type: 'string' }] })
  })

  it('deduplicates before building anyOf', () => {
    const unified = unifyBodyShapes([{ type: 'string' }, { type: 'string' }])
    expect(unified).toEqual({ type: 'string' })
  })

  it('an empty list yields unknown', () => {
    expect(unifyBodyShapes([])).toEqual({ type: 'unknown' })
  })
})

describe('canonicalShapeKey', () => {
  it('does not depend on key insertion order', () => {
    const left: BodyShape = { type: 'object', properties: { b: { type: 'number' }, a: { type: 'string' } } }
    const right: BodyShape = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } }
    expect(canonicalShapeKey(left)).toBe(canonicalShapeKey(right))
  })
})

describe('BodyShapeSchema', () => {
  it('every shape produced by valueToBodyShape is valid — derivation and schema cannot drift apart', () => {
    const values: unknown[] = [
      null,
      'x',
      1,
      true,
      [],
      [1, 'a'],
      [{ id: 1 }, { id: 2, tags: ['a'] }],
      { a: { b: { c: [null, { d: false }] } } },
      { mixed: [1, 'a', null] },
    ]

    for (const value of values) {
      const shape = valueToBodyShape(value)
      const result = BodyShapeSchema.safeParse(shape)
      expect(result.success, JSON.stringify(shape)).toBe(true)
    }
  })

  it('validates deeply nested shapes (the recursive schema really works)', () => {
    const deep: BodyShape = {
      type: 'object',
      properties: {
        a: { type: 'array', items: { anyOf: [{ type: 'null' }, { type: 'string' }] } },
      },
    }
    expect(BodyShapeSchema.safeParse(deep).success).toBe(true)
  })

  it('rejects a type that is not in the list', () => {
    expect(BodyShapeSchema.safeParse({ type: 'date' }).success).toBe(false)
  })

  it('rejects an empty anyOf', () => {
    expect(BodyShapeSchema.safeParse({ anyOf: [] }).success).toBe(false)
  })
})
