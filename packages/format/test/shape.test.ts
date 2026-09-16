import { describe, expect, it } from 'vitest'
import {
  BodyShapeSchema,
  canonicalShapeKey,
  unifyBodyShapes,
  valueToBodyShape,
  type BodyShape,
} from '../src/shape'

describe('valueToBodyShape', () => {
  it('suy ra type của primitive và null', () => {
    expect(valueToBodyShape('x')).toEqual({ type: 'string' })
    expect(valueToBodyShape(1)).toEqual({ type: 'number' })
    expect(valueToBodyShape(true)).toEqual({ type: 'boolean' })
    expect(valueToBodyShape(null)).toEqual({ type: 'null' })
  })

  it('suy ra object lồng nhau và sắp key để deterministic', () => {
    expect(valueToBodyShape({ b: 1, a: 'x' })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    })
  })

  it('array rỗng cho items unknown, không phải object rỗng', () => {
    expect(valueToBodyShape([])).toEqual({ type: 'array', items: { type: 'unknown' } })
  })

  it('array phần tử thiếu key khác nhau thì merge key, KHÔNG tạo anyOf', () => {
    const shape = valueToBodyShape([{ id: 1 }, { id: 2, name: 'b' }])
    expect(shape).toEqual({
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } } },
    })
  })

  it('KHÔNG giữ lại value — đây là bảo đảm privacy của cả format', () => {
    const secret = 'SUPERSECRET_CANARY_12345'
    const serialized = JSON.stringify(valueToBodyShape({ token: secret, nested: { a: secret } }))
    expect(serialized).not.toContain(secret)
  })
})

describe('unifyBodyShapes', () => {
  it('gộp array cùng kiểu items', () => {
    const unified = unifyBodyShapes([{ type: 'array', items: { type: 'string' } }])
    expect(unified).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('kiểu khác nhau cho anyOf, sắp xếp deterministic', () => {
    const a = unifyBodyShapes([{ type: 'string' }, { type: 'number' }])
    const b = unifyBodyShapes([{ type: 'number' }, { type: 'string' }])
    expect(canonicalShapeKey(a)).toBe(canonicalShapeKey(b))
    expect(a).toEqual({ anyOf: [{ type: 'number' }, { type: 'string' }] })
  })

  it('khử trùng lặp trước khi tạo anyOf', () => {
    const unified = unifyBodyShapes([{ type: 'string' }, { type: 'string' }])
    expect(unified).toEqual({ type: 'string' })
  })

  it('danh sách rỗng cho unknown', () => {
    expect(unifyBodyShapes([])).toEqual({ type: 'unknown' })
  })
})

describe('canonicalShapeKey', () => {
  it('không phụ thuộc thứ tự key được chèn', () => {
    const left: BodyShape = { type: 'object', properties: { b: { type: 'number' }, a: { type: 'string' } } }
    const right: BodyShape = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } }
    expect(canonicalShapeKey(left)).toBe(canonicalShapeKey(right))
  })
})

describe('BodyShapeSchema', () => {
  it('mọi shape do valueToBodyShape sinh ra đều hợp lệ — derivation và schema không thể lệch', () => {
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

  it('validate được shape lồng sâu (schema đệ quy thật sự hoạt động)', () => {
    const deep: BodyShape = {
      type: 'object',
      properties: {
        a: { type: 'array', items: { anyOf: [{ type: 'null' }, { type: 'string' }] } },
      },
    }
    expect(BodyShapeSchema.safeParse(deep).success).toBe(true)
  })

  it('từ chối type không nằm trong danh sách', () => {
    expect(BodyShapeSchema.safeParse({ type: 'date' }).success).toBe(false)
  })

  it('từ chối anyOf rỗng', () => {
    expect(BodyShapeSchema.safeParse({ anyOf: [] }).success).toBe(false)
  })
})
