import {
  canonicalShapeKey,
  isAnyOfShape,
  isArrayShape,
  isObjectShape,
  type BodyShape,
  type CapsuleArchive,
  type NetworkRequest,
} from '@bugcapsule/format'

/**
 * Diff engine: compares two capsules and returns **signals**, not a raw list of
 * differences.
 *
 * Three principles govern this entire file:
 *
 * 1. Every signal must explain itself — it carries `confidence` and `reason`. A
 *    diff line that cannot justify its own trust does not deserve to be shown.
 * 2. Never hide anything silently. What is hidden lives in `hidden`, what is
 *    dropped lives in `dropped` with a count. The user can always count.
 * 3. Presentation order is part of the quality: the root cause must come before
 *    its consequences.
 */

export type SignalKind =
  | 'status-class-change'
  | 'presence-change'
  | 'type-change'
  | 'nullability-change'
  | 'schema-shape-change'
  | 'request-only-in-broken'
  | 'request-only-in-baseline'
  | 'duration-outlier'
  | 'console-error-appeared'
  | 'console-warn-appeared'
  | 'console-error-disappeared'
  | 'console-message-changed'
  | 'state-key-added'
  | 'state-key-removed'
  | 'state-type-changed'
  | 'state-value-changed'
  | 'environment-changed'
  | 'action-only-in-broken'
  | 'action-only-in-baseline'

export type SignalTarget = 'network' | 'console' | 'state' | 'environment' | 'actions'
export type DefaultVisibility = 'shown' | 'hidden'
export type SignalConfidence = 'high' | 'medium' | 'low'
export type SignalWeight = 1 | 2 | 3

/**
 * Priority order among signal kinds with the **same weight and same proximity**.
 *
 * Without this table the order falls back to alphabetical string comparison, and
 * `presence-change` would come before `status-class-change` — meaning the five
 * consequences of a 500 error would bury that 500 itself underneath. The root
 * cause must be readable first.
 */
const SIGNAL_PRIORITY: Record<SignalKind, number> = {
  'status-class-change': 0,
  'console-error-appeared': 1,
  'request-only-in-broken': 2,
  'request-only-in-baseline': 2,
  'state-key-removed': 2,
  'state-key-added': 2,
  'state-type-changed': 2,
  'environment-changed': 3,
  'presence-change': 4,
  'type-change': 4,
  'nullability-change': 4,
  'schema-shape-change': 4,
  'duration-outlier': 5,
  'console-warn-appeared': 5,
  'console-error-disappeared': 5,
  'console-message-changed': 6,
  'state-value-changed': 6,
  'action-only-in-broken': 7,
  'action-only-in-baseline': 7,
}

export interface DiffSignal {
  id: string
  kind: SignalKind
  weight: SignalWeight
  defaultVisibility: DefaultVisibility
  target: SignalTarget
  /** Human-readable label, for example `POST /api/checkout`. */
  label: string
  /** Request match key — groups multiple signals that talk about the same request. */
  matchKey?: string
  /** Field path inside the capsule, for example `response.orderId`. */
  field?: string
  summary: string
  before?: unknown
  after?: unknown
  offsetMs?: number
  proximityMs?: number
  confidence: SignalConfidence
  reason: string
}

export interface DroppedCount {
  kind: string
  count: number
}

export interface SuppressedSignal {
  id: string
  reason: string
}

export interface CapsuleDiff {
  signals: DiffSignal[]
  hidden: DiffSignal[]
  dropped: DroppedCount[]
  suppressed: SuppressedSignal[]
  suppressedCount: number
  firstAnomalyMs: number | null
}

export interface DiffOptions {
  /** Ids of signals the user has dismissed, stored per project on the viewer side. */
  suppressed?: readonly string[]
}

type SignalDraft = Omit<DiffSignal, 'id'>

function makeSignal(draft: SignalDraft): DiffSignal {
  const id = [
    draft.target,
    draft.matchKey ?? draft.label,
    draft.field ?? '',
    draft.kind,
  ].join('|')
  return { ...draft, id }
}

// ---------------------------------------------------------------------------
// First anomaly timestamp
// ---------------------------------------------------------------------------

/**
 * `proximityMs` measures the distance to the **first anomaly**, not to the start
 * of the capture session: an ordinary request at second 29 does not deserve to
 * be pushed down just because it happened late.
 */
export function firstAnomalyMs(capsule: CapsuleArchive): number | null {
  const times: number[] = []

  for (const request of capsule.network?.requests ?? []) {
    if (request.status >= 400) times.push(request.offsetMs)
  }
  for (const entry of capsule.console?.entries ?? []) {
    if (entry.level === 'error') times.push(entry.offsetMs)
  }

  return times.length === 0 ? null : Math.min(...times)
}

// ---------------------------------------------------------------------------
// Shape description
// ---------------------------------------------------------------------------

function shapeLabel(shape: BodyShape): string {
  if (isAnyOfShape(shape)) return shape.anyOf.map(shapeLabel).sort().join('|')
  if (isObjectShape(shape)) return 'object'
  if (isArrayShape(shape)) return `array<${shapeLabel(shape.items)}>`
  return shape.type
}

function isNullish(shape: BodyShape): boolean {
  if (isAnyOfShape(shape)) return shape.anyOf.some(isNullish)
  return shape.type === 'null'
}

interface ShapeDifference {
  field: string
  kind: Extract<SignalKind, 'presence-change' | 'type-change' | 'nullability-change' | 'schema-shape-change'>
  before?: string
  after?: string
}

/**
 * Compares two shapes field by field instead of one "schema changed" line.
 *
 * A dev needs to know *which field* changed; collapsing that into "response
 * schema changed" throws away exactly the information that has value.
 */
export function diffBodyShapes(
  before: BodyShape | undefined,
  after: BodyShape | undefined,
  path: string,
): ShapeDifference[] {
  if (before === undefined && after === undefined) return []

  if (before === undefined || after === undefined) {
    return [
      {
        field: path,
        kind: 'presence-change',
        before: before === undefined ? undefined : shapeLabel(before),
        after: after === undefined ? undefined : shapeLabel(after),
      },
    ]
  }

  if (isObjectShape(before) && isObjectShape(after)) {
    const differences: ShapeDifference[] = []

    for (const key of Object.keys(before.properties).sort()) {
      if (!(key in after.properties)) {
        differences.push({
          field: `${path}.${key}`,
          kind: 'presence-change',
          before: shapeLabel(before.properties[key]!),
        })
      }
    }
    for (const key of Object.keys(after.properties).sort()) {
      if (!(key in before.properties)) {
        differences.push({
          field: `${path}.${key}`,
          kind: 'presence-change',
          after: shapeLabel(after.properties[key]!),
        })
      }
    }
    for (const key of Object.keys(before.properties).sort()) {
      const beforeChild = before.properties[key]
      const afterChild = after.properties[key]
      if (beforeChild === undefined || afterChild === undefined) continue
      differences.push(...diffBodyShapes(beforeChild, afterChild, `${path}.${key}`))
    }

    return differences
  }

  if (isArrayShape(before) && isArrayShape(after)) {
    return diffBodyShapes(before.items, after.items, `${path}[]`)
  }

  if (canonicalShapeKey(before) === canonicalShapeKey(after)) return []

  // `field: string` → `field: string|null` means an optional field came back as
  // null, not a data type change. This is one of the most common bugs.
  const kind = isNullish(before) !== isNullish(after) ? 'nullability-change' : 'type-change'
  if (kind === 'type-change' && (isAnyOfShape(before) || isAnyOfShape(after))) {
    return [
      {
        field: path,
        kind: 'schema-shape-change',
        before: shapeLabel(before),
        after: shapeLabel(after),
      },
    ]
  }

  return [{ field: path, kind, before: shapeLabel(before), after: shapeLabel(after) }]
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function matchKeyOf(request: NetworkRequest): string {
  const querySignature = Object.keys(request.url.query).sort().join('&')
  const base = `${request.method} ${request.url.pathname}`
  return querySignature === '' ? base : `${base}?${querySignature}`
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [item])
    else bucket.push(item)
  }
  return groups
}

const DURATION_ABSOLUTE_DELTA_MS = 1000
const DURATION_RATIO = 3

function diffOneRequest(
  before: NetworkRequest,
  after: NetworkRequest,
  matchKey: string,
  proximityOf: (offsetMs: number) => number | undefined,
): DiffSignal[] {
  const signals: DiffSignal[] = []
  const label = `${after.method} ${after.url.pathname}`

  const beforeClass = Math.floor(before.status / 100)
  const afterClass = Math.floor(after.status / 100)
  if (beforeClass !== afterClass) {
    signals.push(
      makeSignal({
        kind: 'status-class-change',
        weight: 3,
        defaultVisibility: 'shown',
        target: 'network',
        label,
        matchKey,
        summary: `${label} moved from ${beforeClass}xx to ${afterClass}xx`,
        before: before.status,
        after: after.status,
        offsetMs: after.offsetMs,
        proximityMs: proximityOf(after.offsetMs),
        confidence: 'high',
        reason: 'HTTP status changed class — this is usually the root cause, not a symptom',
      }),
    )
  }

  return signals
}

function durationSignal(
  before: NetworkRequest,
  after: NetworkRequest,
  matchKey: string,
  proximityOf: (offsetMs: number) => number | undefined,
): { signal?: DiffSignal; noise: boolean } {
  const delta = after.durationMs - before.durationMs
  if (delta <= 0) return { noise: false }

  const ratio = before.durationMs > 0 ? after.durationMs / before.durationMs : Infinity
  const isOutlier = delta >= DURATION_ABSOLUTE_DELTA_MS && ratio >= DURATION_RATIO

  if (!isOutlier) return { noise: true }

  const label = `${after.method} ${after.url.pathname}`
  return {
    noise: false,
    signal: makeSignal({
      kind: 'duration-outlier',
      weight: 2,
      defaultVisibility: 'shown',
      target: 'network',
      label,
      matchKey,
      summary: `${label} is ${delta}ms slower (${before.durationMs}ms → ${after.durationMs}ms)`,
      before: before.durationMs,
      after: after.durationMs,
      offsetMs: after.offsetMs,
      proximityMs: proximityOf(after.offsetMs),
      confidence: 'low',
      reason: `delta >= ${DURATION_ABSOLUTE_DELTA_MS}ms and >= ${DURATION_RATIO}x; latency is noisy by nature, so this is only a hint`,
    }),
  }
}

function shapesComparable(baseline: CapsuleArchive, candidate: CapsuleArchive): boolean {
  return (
    baseline.privacy?.policy.bodyShapes !== false && candidate.privacy?.policy.bodyShapes !== false
  )
}

function diffNetwork(
  baseline: CapsuleArchive,
  candidate: CapsuleArchive,
  proximityOf: (offsetMs: number) => number | undefined,
): { signals: DiffSignal[]; dropped: Map<string, number> } {
  const signals: DiffSignal[] = []
  const dropped = new Map<string, number>()
  const compareShapes = shapesComparable(baseline, candidate)

  const beforeGroups = groupBy(baseline.network?.requests ?? [], matchKeyOf)
  const afterGroups = groupBy(candidate.network?.requests ?? [], matchKeyOf)
  const allKeys = [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort()

  for (const matchKey of allKeys) {
    const before = beforeGroups.get(matchKey) ?? []
    const after = afterGroups.get(matchKey) ?? []
    const paired = Math.min(before.length, after.length)

    for (let index = 0; index < paired; index += 1) {
      const left = before[index]!
      const right = after[index]!
      const label = `${right.method} ${right.url.pathname}`

      signals.push(...diffOneRequest(left, right, matchKey, proximityOf))

      const duration = durationSignal(left, right, matchKey, proximityOf)
      if (duration.signal !== undefined) signals.push(duration.signal)
      if (duration.noise) {
        dropped.set('duration-noise', (dropped.get('duration-noise') ?? 0) + 1)
      }

      if (!compareShapes) {
        dropped.set('shape-diff-skipped-policy', (dropped.get('shape-diff-skipped-policy') ?? 0) + 1)
        continue
      }

      for (const side of ['request', 'response'] as const) {
        for (const difference of diffBodyShapes(left[side].bodyShape, right[side].bodyShape, side)) {
          signals.push(
            makeSignal({
              kind: difference.kind,
              weight: 3,
              defaultVisibility: 'shown',
              target: 'network',
              label,
              matchKey,
              field: difference.field,
              summary: describeShapeDifference(label, difference),
              before: difference.before,
              after: difference.after,
              offsetMs: right.offsetMs,
              proximityMs: proximityOf(right.offsetMs),
              confidence: 'high',
              reason:
                'body shape is structure, not values — this signal does not depend on capturing the body',
            }),
          )
        }
      }
    }

    for (let index = paired; index < after.length; index += 1) {
      const request = after[index]!
      signals.push(
        makeSignal({
          kind: 'request-only-in-broken',
          weight: 3,
          defaultVisibility: 'shown',
          target: 'network',
          label: `${request.method} ${request.url.pathname}`,
          matchKey,
          summary: `request only present on the broken side: ${request.method} ${request.url.pathname}`,
          after: request.status,
          offsetMs: request.offsetMs,
          proximityMs: proximityOf(request.offsetMs),
          confidence: 'medium',
          reason:
            'the request is absent on the working side; it may be a consequence (retry) or a code branch that only runs on failure',
        }),
      )
    }

    for (let index = paired; index < before.length; index += 1) {
      const request = before[index]!
      signals.push(
        makeSignal({
          kind: 'request-only-in-baseline',
          weight: 3,
          defaultVisibility: 'shown',
          target: 'network',
          label: `${request.method} ${request.url.pathname}`,
          matchKey,
          summary: `request only present on the working side: ${request.method} ${request.url.pathname}`,
          before: request.status,
          offsetMs: request.offsetMs,
          proximityMs: proximityOf(request.offsetMs),
          confidence: 'medium',
          reason: 'the request disappeared on the broken side — usually a sign that a step was skipped',
        }),
      )
    }
  }

  return { signals, dropped }
}

function describeShapeDifference(label: string, difference: ShapeDifference): string {
  const where = `${label} → ${difference.field}`
  switch (difference.kind) {
    case 'presence-change':
      return difference.before === undefined
        ? `${where} newly appeared (${difference.after})`
        : `${where} disappeared (previously ${difference.before})`
    case 'nullability-change':
      return `${where} became nullable: ${difference.before} → ${difference.after}`
    case 'type-change':
      return `${where} changed type: ${difference.before} → ${difference.after}`
    default:
      return `${where} changed structure: ${difference.before} → ${difference.after}`
  }
}

// ---------------------------------------------------------------------------
// Console, state, environment, actions
// ---------------------------------------------------------------------------

function diffConsole(
  baseline: CapsuleArchive,
  candidate: CapsuleArchive,
  proximityOf: (offsetMs: number) => number | undefined,
): DiffSignal[] {
  const signals: DiffSignal[] = []

  const levelsOf = (capsule: CapsuleArchive, level: string): string[] =>
    (capsule.console?.entries ?? [])
      .filter((entry) => entry.level === level)
      .map((entry) => entry.message)

  const firstErrorOf = (capsule: CapsuleArchive) =>
    (capsule.console?.entries ?? []).find((entry) => entry.level === 'error')

  const beforeErrors = levelsOf(baseline, 'error')
  const afterErrors = levelsOf(candidate, 'error')

  if (beforeErrors.length === 0 && afterErrors.length > 0) {
    const entry = firstErrorOf(candidate)!
    signals.push(
      makeSignal({
        kind: 'console-error-appeared',
        weight: 3,
        defaultVisibility: 'shown',
        target: 'console',
        label: 'console',
        field: 'error',
        summary: `new console error: ${entry.message}`,
        after: entry.message,
        offsetMs: entry.offsetMs,
        proximityMs: proximityOf(entry.offsetMs),
        confidence: 'high',
        reason: 'the working side has no console errors at all; this is the first anomaly in time order',
      }),
    )
  } else if (beforeErrors.length > 0 && afterErrors.length === 0) {
    signals.push(
      makeSignal({
        kind: 'console-error-disappeared',
        weight: 2,
        defaultVisibility: 'shown',
        target: 'console',
        label: 'console',
        field: 'error',
        summary: 'the console error on the working side disappeared',
        before: beforeErrors[0],
        confidence: 'medium',
        reason: 'a disappearing error is usually good news, but it can also mean a code path is no longer reached',
      }),
    )
  } else if (beforeErrors.length > 0 && afterErrors.length > 0) {
    const beforeSet = new Set(beforeErrors)
    const changed = afterErrors.filter((message) => !beforeSet.has(message))
    if (changed.length > 0) {
      signals.push(
        makeSignal({
          kind: 'console-message-changed',
          weight: 1,
          defaultVisibility: 'shown',
          target: 'console',
          label: 'console',
          field: 'error',
          summary: `console error text changed: ${changed[0]}`,
          before: beforeErrors[0],
          after: changed[0],
          confidence: 'low',
          reason: 'both sides have an error; only the text differs, so this signal is weak',
        }),
      )
    }
  }

  const beforeWarns = levelsOf(baseline, 'warn')
  const afterWarns = levelsOf(candidate, 'warn')
  if (beforeWarns.length === 0 && afterWarns.length > 0) {
    const entry = (candidate.console?.entries ?? []).find((item) => item.level === 'warn')!
    signals.push(
      makeSignal({
        kind: 'console-warn-appeared',
        weight: 2,
        defaultVisibility: 'shown',
        target: 'console',
        label: 'console',
        field: 'warn',
        summary: `new console warn: ${entry.message}`,
        after: entry.message,
        offsetMs: entry.offsetMs,
        proximityMs: proximityOf(entry.offsetMs),
        confidence: 'medium',
        reason: 'the new warn appears at the same time as the error — usually a consequence',
      }),
    )
  }

  return signals
}

function diffState(
  baseline: CapsuleArchive,
  candidate: CapsuleArchive,
  proximityOf: (offsetMs: number) => number | undefined,
): DiffSignal[] {
  const signals: DiffSignal[] = []

  for (const area of ['localStorage', 'sessionStorage'] as const) {
    const beforeEntries = baseline.state?.[area] ?? []
    const afterEntries = candidate.state?.[area] ?? []
    const beforeByKey = new Map(beforeEntries.map((entry) => [entry.key, entry]))
    const afterByKey = new Map(afterEntries.map((entry) => [entry.key, entry]))

    for (const key of [...beforeByKey.keys()].sort()) {
      if (afterByKey.has(key)) continue
      signals.push(
        makeSignal({
          kind: 'state-key-removed',
          weight: 3,
          defaultVisibility: 'shown',
          target: 'state',
          label: area,
          field: `${area}.${key}`,
          summary: `${key} disappeared from ${area}`,
          before: beforeByKey.get(key)?.valueType,
          confidence: 'high',
          reason: 'key presence is structure, observable even when the value is hidden',
        }),
      )
    }

    for (const key of [...afterByKey.keys()].sort()) {
      if (beforeByKey.has(key)) continue
      signals.push(
        makeSignal({
          kind: 'state-key-added',
          weight: 3,
          defaultVisibility: 'shown',
          target: 'state',
          label: area,
          field: `${area}.${key}`,
          summary: `${key} newly appeared in ${area}`,
          after: afterByKey.get(key)?.valueType,
          confidence: 'high',
          reason: 'key presence is structure, observable even when the value is hidden',
        }),
      )
    }

    for (const key of [...beforeByKey.keys()].sort()) {
      const before = beforeByKey.get(key)
      const after = afterByKey.get(key)
      if (before === undefined || after === undefined) continue
      const field = `${area}.${key}`

      if (
        before.valueType !== undefined &&
        after.valueType !== undefined &&
        before.valueType !== after.valueType
      ) {
        signals.push(
          makeSignal({
            kind: 'state-type-changed',
            weight: 3,
            defaultVisibility: 'shown',
            target: 'state',
            label: area,
            field,
            summary: `${key} changed type: ${before.valueType} → ${after.valueType}`,
            before: before.valueType,
            after: after.valueType,
            confidence: 'high',
            reason: 'the value type is structure, not user data',
          }),
        )
        continue
      }

      if (before.value === undefined || after.value === undefined) continue
      if (JSON.stringify(before.value) === JSON.stringify(after.value)) continue

      // A boolean is 1 bit of information and cannot be PII, so a feature flag
      // flipping false→true is both private and high-signal. Strings/numbers are
      // the opposite: likely an id, timestamp or token — hidden by default.
      const isBoolean = before.valueType === 'boolean' && after.valueType === 'boolean'
      signals.push(
        makeSignal({
          kind: 'state-value-changed',
          weight: isBoolean ? 2 : 1,
          defaultVisibility: isBoolean ? 'shown' : 'hidden',
          target: 'state',
          label: area,
          field,
          summary: isBoolean
            ? `${key} flipped ${String(before.value)} → ${String(after.value)}`
            : `${key} changed value`,
          before: before.value,
          after: after.value,
          confidence: isBoolean ? 'medium' : 'low',
          reason: isBoolean
            ? 'a boolean value cannot be PII, so it is shown by default'
            : 'a string/number value is likely an id or timestamp; hidden by default to avoid noise',
        }),
      )
    }
  }

  const beforeCookies = new Set(baseline.state?.cookieNames ?? [])
  const afterCookies = new Set(candidate.state?.cookieNames ?? [])

  for (const name of [...beforeCookies].sort()) {
    if (afterCookies.has(name)) continue
    signals.push(
      makeSignal({
        kind: 'state-key-removed',
        weight: 3,
        defaultVisibility: 'shown',
        target: 'state',
        label: 'cookieNames',
        field: `cookieNames.${name}`,
        summary: `cookie ${name} is no longer set`,
        confidence: 'high',
        reason: 'a missing cookie is a common cause of broken login sessions',
      }),
    )
  }
  for (const name of [...afterCookies].sort()) {
    if (beforeCookies.has(name)) continue
    signals.push(
      makeSignal({
        kind: 'state-key-added',
        weight: 3,
        defaultVisibility: 'shown',
        target: 'state',
        label: 'cookieNames',
        field: `cookieNames.${name}`,
        summary: `cookie ${name} is newly set`,
        confidence: 'high',
        reason: 'a new cookie appeared — name only, never a value',
      }),
    )
  }

  return signals
}

function flattenEnvironment(capsule: CapsuleArchive): Map<string, unknown> {
  const flat = new Map<string, unknown>()
  const environment = capsule.environment
  if (environment === undefined) return flat

  flat.set('browser.name', environment.browser.name)
  flat.set('browser.version', environment.browser.version)
  flat.set('os.name', environment.os.name)
  flat.set('os.version', environment.os.version)
  flat.set('viewport.width', environment.viewport.width)
  flat.set('viewport.height', environment.viewport.height)
  flat.set('viewport.devicePixelRatio', environment.viewport.devicePixelRatio)
  flat.set('locale', environment.locale)
  flat.set('timezone', environment.timezone)
  flat.set('network.online', environment.network?.online)
  flat.set('document.visibilityState', environment.document?.visibilityState)
  flat.set('build', environment.build)

  return flat
}

function diffEnvironment(baseline: CapsuleArchive, candidate: CapsuleArchive): DiffSignal[] {
  const signals: DiffSignal[] = []
  const before = flattenEnvironment(baseline)
  const after = flattenEnvironment(candidate)

  for (const field of [...before.keys()].sort()) {
    const left = before.get(field)
    const right = after.get(field)
    if (left === undefined || right === undefined) continue
    if (left === right) continue

    // A different `build` means the bug may exist in only one deploy — that is a
    // root cause. The other environment fields are only context.
    const isBuild = field === 'build'
    signals.push(
      makeSignal({
        kind: 'environment-changed',
        weight: isBuild ? 3 : 1,
        defaultVisibility: 'shown',
        target: 'environment',
        label: 'environment',
        field,
        summary: isBuild ? `different deploy: ${String(left)} → ${String(right)}` : `${field} differs`,
        before: left,
        after: right,
        confidence: isBuild ? 'medium' : 'low',
        reason: isBuild
          ? 'the two capsules run on different builds, so the difference may not be caused by the bug'
          : 'environment context, almost never the cause',
      }),
    )
  }

  return signals
}

function diffActions(baseline: CapsuleArchive, candidate: CapsuleArchive): DiffSignal[] {
  const signals: DiffSignal[] = []
  const keyOf = (event: { target?: { selector: string }; url?: string }): string =>
    event.target?.selector ?? event.url ?? 'unknown'

  const beforeKeys = (baseline.actions?.events ?? []).map(keyOf)
  const afterKeys = (candidate.actions?.events ?? []).map(keyOf)
  const beforeSet = new Set(beforeKeys)
  const afterSet = new Set(afterKeys)

  for (const key of afterKeys) {
    if (beforeSet.has(key)) continue
    signals.push(
      makeSignal({
        kind: 'action-only-in-broken',
        weight: 1,
        defaultVisibility: 'shown',
        target: 'actions',
        label: key,
        summary: `only the broken side has an action on ${key}`,
        confidence: 'low',
        reason: 'an extra action is usually a consequence of the error, not the cause',
      }),
    )
  }
  for (const key of beforeKeys) {
    if (afterSet.has(key)) continue
    signals.push(
      makeSignal({
        kind: 'action-only-in-baseline',
        weight: 1,
        defaultVisibility: 'shown',
        target: 'actions',
        label: key,
        summary: `only the working side has an action on ${key}`,
        confidence: 'low',
        reason: 'the action is missing on the broken side',
      }),
    )
  }

  return signals
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function diffCapsules(
  baseline: CapsuleArchive,
  candidate: CapsuleArchive,
  options: DiffOptions = {},
): CapsuleDiff {
  const firstAnomaly = firstAnomalyMs(candidate)
  const proximityOf = (offsetMs: number): number | undefined =>
    firstAnomaly === null ? undefined : offsetMs - firstAnomaly

  const network = diffNetwork(baseline, candidate, proximityOf)
  const all = [
    ...network.signals,
    ...diffConsole(baseline, candidate, proximityOf),
    ...diffState(baseline, candidate, proximityOf),
    ...diffEnvironment(baseline, candidate),
    ...diffActions(baseline, candidate),
  ]

  all.sort((left, right) => {
    if (left.weight !== right.weight) return right.weight - left.weight

    // Closer to the first anomaly comes first: a consequence always happens
    // after its cause, so this distance is itself a signal.
    const leftDistance = left.proximityMs ?? Number.POSITIVE_INFINITY
    const rightDistance = right.proximityMs ?? Number.POSITIVE_INFINITY
    if (leftDistance !== rightDistance) return leftDistance - rightDistance

    if (SIGNAL_PRIORITY[left.kind] !== SIGNAL_PRIORITY[right.kind]) {
      return SIGNAL_PRIORITY[left.kind] - SIGNAL_PRIORITY[right.kind]
    }

    if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })

  const suppressedIds = new Set(options.suppressed ?? [])
  const suppressed: SuppressedSignal[] = []
  const kept: DiffSignal[] = []

  for (const signal of all) {
    if (suppressedIds.has(signal.id)) {
      suppressed.push({ id: signal.id, reason: 'dismissed by the user' })
      continue
    }
    kept.push(signal)
  }

  const dropped: DroppedCount[] = [...network.dropped.entries()]
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0))

  return {
    signals: kept.filter((signal) => signal.defaultVisibility === 'shown'),
    hidden: kept.filter((signal) => signal.defaultVisibility === 'hidden'),
    dropped,
    suppressed,
    suppressedCount: suppressed.length,
    firstAnomalyMs: firstAnomaly,
  }
}
