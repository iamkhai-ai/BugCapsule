import * as z from 'zod'

/**
 * Minimal type tree of a JSON value. **Contains no values.**
 *
 * This is the source of most of the valuable diff signal (type-change,
 * nullability-change, presence-change) without reading any user data.
 * The shape is inferred inside the page context; only the shape crosses the bridge.
 */
export type BodyShape =
  | { type: 'object'; properties: Record<string, BodyShape> }
  | { type: 'array'; items: BodyShape }
  | { type: 'string' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'null' }
  | { type: 'unknown' }
  | { anyOf: BodyShape[] }

export const BodyShapeSchema: z.ZodType<BodyShape> = z.lazy(() =>
  z.union([
    z.object({ anyOf: z.array(BodyShapeSchema).min(1) }),
    z.object({ type: z.literal('object'), properties: z.record(z.string(), BodyShapeSchema) }),
    z.object({ type: z.literal('array'), items: BodyShapeSchema }),
    z.object({ type: z.enum(['string', 'number', 'boolean', 'null', 'unknown']) }),
  ]),
)

export function isAnyOfShape(shape: BodyShape): shape is { anyOf: BodyShape[] } {
  return 'anyOf' in shape
}

export function isObjectShape(
  shape: BodyShape,
): shape is { type: 'object'; properties: Record<string, BodyShape> } {
  return 'type' in shape && shape.type === 'object'
}

export function isArrayShape(shape: BodyShape): shape is { type: 'array'; items: BodyShape } {
  return 'type' in shape && shape.type === 'array'
}

/** Infers a shape from a value. This is the ONLY function allowed to see values. */
export function valueToBodyShape(value: unknown): BodyShape {
  if (value === null) return { type: 'null' }

  if (Array.isArray(value)) {
    return { type: 'array', items: unifyBodyShapes(value.map(valueToBodyShape)) }
  }

  switch (typeof value) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'object': {
      const source = value as Record<string, unknown>
      const properties: Record<string, BodyShape> = {}
      for (const key of Object.keys(source).sort()) {
        properties[key] = valueToBodyShape(source[key])
      }
      return { type: 'object', properties }
    }
    default:
      return { type: 'unknown' }
  }
}

/**
 * Unifies several shapes into one.
 *
 * Objects are **merged by key** rather than collapsed into `anyOf`: an array of
 * elements where each element is missing a different key is unremarkable, and
 * turning it into a union would produce a fake schema-shape-change.
 */
export function unifyBodyShapes(shapes: BodyShape[]): BodyShape {
  if (shapes.length === 0) return { type: 'unknown' }

  if (shapes.every(isObjectShape)) {
    const keys = new Set<string>()
    for (const shape of shapes) {
      for (const key of Object.keys(shape.properties)) keys.add(key)
    }

    const properties: Record<string, BodyShape> = {}
    for (const key of [...keys].sort()) {
      const perKey = shapes
        .map((shape) => shape.properties[key])
        .filter((value): value is BodyShape => value !== undefined)
      properties[key] = unifyBodyShapes(perKey)
    }
    return { type: 'object', properties }
  }

  if (shapes.every(isArrayShape)) {
    return { type: 'array', items: unifyBodyShapes(shapes.map((shape) => shape.items)) }
  }

  const unique = new Map<string, BodyShape>()
  for (const shape of shapes) unique.set(canonicalShapeKey(shape), shape)

  const sorted = [...unique.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, shape]) => shape)

  if (sorted.length === 1) return sorted[0] as BodyShape
  return { anyOf: sorted }
}

/** Canonical key of a shape — deterministic, used for comparison and deduplication. */
export function canonicalShapeKey(shape: BodyShape): string {
  return JSON.stringify(canonicalizeShape(shape))
}

function canonicalizeShape(shape: BodyShape): unknown {
  if (isAnyOfShape(shape)) return { anyOf: shape.anyOf.map(canonicalizeShape) }

  if (isObjectShape(shape)) {
    const properties: Record<string, unknown> = {}
    for (const key of Object.keys(shape.properties).sort()) {
      properties[key] = canonicalizeShape(shape.properties[key])
    }
    return { type: 'object', properties }
  }

  if (isArrayShape(shape)) return { type: 'array', items: canonicalizeShape(shape.items) }

  return { type: shape.type }
}
