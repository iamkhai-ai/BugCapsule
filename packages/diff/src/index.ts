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
 * Diff engine: so sánh hai capsule và trả về **tín hiệu**, không trả về danh
 * sách khác biệt thô.
 *
 * Ba nguyên tắc chi phối toàn bộ file này:
 *
 * 1. Mọi signal phải tự giải thích được — có `confidence` và `reason`. Một
 *    diff line không nói được vì sao nó đáng tin thì không đáng hiển thị.
 * 2. Không bao giờ che giấu im lặng. Thứ bị ẩn nằm trong `hidden`, thứ bị loại
 *    nằm trong `dropped` kèm số lượng. Người dùng luôn đếm được.
 * 3. Thứ tự trình bày là một phần của chất lượng: nguyên nhân gốc phải đứng
 *    trước hệ quả.
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
 * Thứ tự ưu tiên giữa các loại tín hiệu **cùng weight và cùng proximity**.
 *
 * Không có bảng này thì thứ tự rơi vào so sánh chuỗi alphabet, và
 * `presence-change` sẽ đứng trước `status-class-change` — tức là năm hệ quả
 * của một lỗi 500 sẽ chôn chính cái 500 đó xuống dưới. Nguyên nhân gốc phải
 * đọc được trước tiên.
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
  /** Nhãn người đọc được, ví dụ `POST /api/checkout`. */
  label: string
  /** Khoá ghép request — nhóm được nhiều signal nói về cùng một request. */
  matchKey?: string
  /** Đường dẫn field trong capsule, ví dụ `response.orderId`. */
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
  /** Id signal người dùng đã bỏ qua, lưu theo project ở phía viewer. */
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
// Mốc thời gian bất thường đầu tiên
// ---------------------------------------------------------------------------

/**
 * `proximityMs` đo khoảng cách tới **bất thường đầu tiên** chứ không tới đầu
 * phiên capture: một request bình thường ở giây thứ 29 không đáng bị đẩy xuống
 * chỉ vì nó xảy ra muộn.
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
// Mô tả shape
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
 * So sánh hai shape theo từng field, không gộp thành một dòng "schema đổi".
 *
 * Một dev cần biết *field nào* đổi; gộp lại thành "response schema changed"
 * là ném đi đúng phần thông tin có giá trị.
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

  // `field: string` → `field: string|null` là chuyện optional field bị trả về
  // null, không phải đổi kiểu dữ liệu. Đây là một trong những bug phổ biến nhất.
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
        summary: `${label} chuyển từ ${beforeClass}xx sang ${afterClass}xx`,
        before: before.status,
        after: after.status,
        offsetMs: after.offsetMs,
        proximityMs: proximityOf(after.offsetMs),
        confidence: 'high',
        reason: 'HTTP status đổi nhóm — đây thường là nguyên nhân gốc, không phải triệu chứng',
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
      summary: `${label} chậm hơn ${delta}ms (${before.durationMs}ms → ${after.durationMs}ms)`,
      before: before.durationMs,
      after: after.durationMs,
      offsetMs: after.offsetMs,
      proximityMs: proximityOf(after.offsetMs),
      confidence: 'low',
      reason: `chênh lệch >= ${DURATION_ABSOLUTE_DELTA_MS}ms và >= ${DURATION_RATIO}x; độ trễ vốn dao động nên đây chỉ là gợi ý`,
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
                'shape của body là cấu trúc, không phải giá trị — tín hiệu này không phụ thuộc việc capture body',
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
          summary: `request chỉ có ở phía hỏng: ${request.method} ${request.url.pathname}`,
          after: request.status,
          offsetMs: request.offsetMs,
          proximityMs: proximityOf(request.offsetMs),
          confidence: 'medium',
          reason:
            'request không có ở phía chạy được; có thể là hệ quả (retry) hoặc nhánh code chỉ chạy khi lỗi',
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
          summary: `request chỉ có ở phía chạy được: ${request.method} ${request.url.pathname}`,
          before: request.status,
          offsetMs: request.offsetMs,
          proximityMs: proximityOf(request.offsetMs),
          confidence: 'medium',
          reason: 'request biến mất ở phía hỏng — thường là dấu hiệu một bước đã bị bỏ qua',
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
        ? `${where} mới xuất hiện (${difference.after})`
        : `${where} biến mất (trước là ${difference.before})`
    case 'nullability-change':
      return `${where} trở thành nullable: ${difference.before} → ${difference.after}`
    case 'type-change':
      return `${where} đổi kiểu: ${difference.before} → ${difference.after}`
    default:
      return `${where} đổi cấu trúc: ${difference.before} → ${difference.after}`
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
        summary: `console error mới: ${entry.message}`,
        after: entry.message,
        offsetMs: entry.offsetMs,
        proximityMs: proximityOf(entry.offsetMs),
        confidence: 'high',
        reason: 'phía chạy được không có console error nào; đây là bất thường đầu tiên theo thời gian',
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
        summary: 'console error ở phía chạy được đã biến mất',
        before: beforeErrors[0],
        confidence: 'medium',
        reason: 'lỗi biến mất thường là tin tốt, nhưng cũng có thể do code path không còn chạy tới',
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
          summary: `nội dung console error đổi: ${changed[0]}`,
          before: beforeErrors[0],
          after: changed[0],
          confidence: 'low',
          reason: 'cả hai phía đều có error; chỉ nội dung khác nên tín hiệu yếu',
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
        summary: `console warn mới: ${entry.message}`,
        after: entry.message,
        offsetMs: entry.offsetMs,
        proximityMs: proximityOf(entry.offsetMs),
        confidence: 'medium',
        reason: 'warn mới xuất hiện cùng lúc với lỗi — thường là hệ quả',
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
          summary: `${key} biến mất khỏi ${area}`,
          before: beforeByKey.get(key)?.valueType,
          confidence: 'high',
          reason: 'sự hiện diện của key là cấu trúc, quan sát được kể cả khi value bị ẩn',
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
          summary: `${key} mới xuất hiện trong ${area}`,
          after: afterByKey.get(key)?.valueType,
          confidence: 'high',
          reason: 'sự hiện diện của key là cấu trúc, quan sát được kể cả khi value bị ẩn',
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
            summary: `${key} đổi kiểu: ${before.valueType} → ${after.valueType}`,
            before: before.valueType,
            after: after.valueType,
            confidence: 'high',
            reason: 'kiểu của value là cấu trúc, không phải dữ liệu người dùng',
          }),
        )
        continue
      }

      if (before.value === undefined || after.value === undefined) continue
      if (JSON.stringify(before.value) === JSON.stringify(after.value)) continue

      // Boolean chỉ có 1 bit thông tin và không thể là PII, nên một feature flag
      // lật false→true là vừa riêng tư vừa nhiều tín hiệu. String/số thì ngược
      // lại: rất dễ là id, timestamp, token — ẩn mặc định.
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
            ? `${key} lật ${String(before.value)} → ${String(after.value)}`
            : `${key} đổi giá trị`,
          before: before.value,
          after: after.value,
          confidence: isBoolean ? 'medium' : 'low',
          reason: isBoolean
            ? 'value boolean không thể là PII, nên hiện mặc định'
            : 'value dạng chuỗi/số dễ là id hoặc timestamp; ẩn mặc định để tránh nhiễu',
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
        summary: `cookie ${name} không còn được set`,
        confidence: 'high',
        reason: 'cookie mất đi là nguyên nhân phổ biến của lỗi phiên đăng nhập',
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
        summary: `cookie ${name} mới được set`,
        confidence: 'high',
        reason: 'cookie mới xuất hiện — chỉ tên, không bao giờ có value',
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

    // `build` khác nhau nghĩa là bug có thể chỉ nằm ở một deploy — đó là nguyên
    // nhân gốc. Các field môi trường khác chỉ là ngữ cảnh.
    const isBuild = field === 'build'
    signals.push(
      makeSignal({
        kind: 'environment-changed',
        weight: isBuild ? 3 : 1,
        defaultVisibility: 'shown',
        target: 'environment',
        label: 'environment',
        field,
        summary: isBuild ? `deploy khác nhau: ${String(left)} → ${String(right)}` : `${field} khác nhau`,
        before: left,
        after: right,
        confidence: isBuild ? 'medium' : 'low',
        reason: isBuild
          ? 'hai capsule chạy trên build khác nhau, nên khác biệt có thể không phải do bug'
          : 'ngữ cảnh môi trường, hầu như không bao giờ là nguyên nhân',
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
        summary: `chỉ phía hỏng có thao tác trên ${key}`,
        confidence: 'low',
        reason: 'thao tác thừa thường là hệ quả của lỗi, không phải nguyên nhân',
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
        summary: `chỉ phía chạy được có thao tác trên ${key}`,
        confidence: 'low',
        reason: 'thao tác bị thiếu ở phía hỏng',
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

    // Gần bất thường đầu tiên hơn thì lên trước: hệ quả luôn xảy ra sau
    // nguyên nhân, nên khoảng cách này tự nó đã là một tín hiệu.
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
      suppressed.push({ id: signal.id, reason: 'người dùng đã bỏ qua' })
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
