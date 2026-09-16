import type { ZodError, ZodType } from 'zod'
import { ActionsFileSchema, type ActionsFile } from './actions'
import { REDACTED } from './common'
import { checkCompatibility } from './compat'
import { ConsoleFileSchema, type ConsoleFile } from './console'
import { EnvironmentSchema, type Environment } from './environment'
import { ManifestSchema, type Manifest } from './manifest'
import { NetworkFileSchema, type NetworkFile } from './network'
import { PrivacySchema, type Privacy } from './privacy'
import { StateFileSchema, type StateFile } from './state'

export interface ValidationIssue {
  path: string
  code: string
  message: string
}

export interface ValidationResult<T> {
  ok: boolean
  value?: T
  issues: ValidationIssue[]
  warnings: string[]
}

export interface ValidateOptions {
  /**
   * `strict` là nghĩa vụ của **producer**: field lạ là lỗi, để bắt typo ngay
   * khi tạo capsule. Reader mặc định KHÔNG strict, vì spec §21 bắt nó bỏ qua
   * field không nhận biết để giữ forward compatibility.
   */
  strict?: boolean
}

export interface CapsuleParts {
  manifest?: unknown
  environment?: unknown
  actions?: unknown
  network?: unknown
  console?: unknown
  state?: unknown
  privacy?: unknown
}

export interface ValidatedCapsule {
  manifest: Manifest
  environment?: Environment
  actions?: ActionsFile
  network?: NetworkFile
  console?: ConsoleFile
  state?: StateFile
  privacy?: Privacy
}

function zodIssues(error: ZodError, prefix: string): ValidationIssue[] {
  return error.issues.map((issue) => {
    const path = [prefix, ...issue.path.map(String)]
      .filter((segment) => segment !== '')
      .join('.')
    return { path, code: 'schema', message: issue.message }
  })
}

function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`
}

function collectUnknownKeys(
  input: unknown,
  parsed: unknown,
  path: string,
  out: ValidationIssue[],
): void {
  if (Array.isArray(input)) {
    if (!Array.isArray(parsed)) return
    input.forEach((item, index) => {
      collectUnknownKeys(item, parsed[index], `${path}[${index}]`, out)
    })
    return
  }

  if (input === null || typeof input !== 'object') return
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return

  const parsedKeys = new Set(Object.keys(parsed as Record<string, unknown>))
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const childPath = joinPath(path, key)

    if (!parsedKeys.has(key)) {
      out.push({
        path: childPath,
        code: 'unknown-field',
        message: `field "${childPath}" không thuộc format v0.1`,
      })
      continue
    }

    collectUnknownKeys(value, (parsed as Record<string, unknown>)[key], childPath, out)
  }
}

function unknownKeyIssues(input: unknown, parsed: unknown, prefix: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  collectUnknownKeys(input, parsed, prefix, issues)
  return issues
}

function manifestInvariants(manifest: Manifest): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (manifest.capture.endedAt < manifest.capture.startedAt) {
    issues.push({
      path: 'capture.endedAt',
      code: 'capture-window-invalid',
      message: 'capture.endedAt xảy ra trước capture.startedAt',
    })
  }

  return issues
}

export function validateManifest(
  input: unknown,
  options: ValidateOptions = {},
): ValidationResult<Manifest> {
  const issues: ValidationIssue[] = []
  const warnings: string[] = []

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      issues: [{ path: '', code: 'not-an-object', message: 'manifest phải là một object' }],
      warnings,
    }
  }

  const rawVersion = (input as Record<string, unknown>).formatVersion
  if (typeof rawVersion === 'string') {
    const compat = checkCompatibility(rawVersion)
    if (compat.level === 'unsupported') {
      issues.push({
        path: 'formatVersion',
        code: 'unsupported-format-version',
        message: compat.reason,
      })
      return { ok: false, issues, warnings }
    }
    if (compat.level === 'forward-minor') warnings.push(compat.reason)
  }

  const parsed = ManifestSchema.safeParse(input)
  if (!parsed.success) {
    issues.push(...zodIssues(parsed.error, ''))
    return { ok: false, issues, warnings }
  }

  if (options.strict === true) {
    issues.push(...unknownKeyIssues(input, parsed.data, ''))
  }

  issues.push(...manifestInvariants(parsed.data))

  if (issues.length > 0) return { ok: false, issues, warnings }
  return { ok: true, value: parsed.data, issues, warnings }
}

function validateOptionalFile<T>(
  schema: ZodType<T>,
  input: unknown,
  prefix: string,
  options: ValidateOptions,
  issues: ValidationIssue[],
): T | undefined {
  if (input === undefined) return undefined

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    issues.push(...zodIssues(parsed.error, prefix))
    return undefined
  }

  if (options.strict === true) {
    issues.push(...unknownKeyIssues(input, parsed.data, prefix))
  }

  return parsed.data
}

function bodyInvariants(network: NetworkFile): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  network.requests.forEach((request, index) => {
    for (const side of ['request', 'response'] as const) {
      const captured = request[side]
      if (!captured.bodyCaptured && captured.body !== undefined) {
        issues.push({
          path: `network.requests[${index}].${side}.body`,
          code: 'body-present-but-not-captured',
          message: `${side}.bodyCaptured=false nhưng ${side}.body vẫn có mặt`,
        })
      }
    }
  })

  return issues
}

function actionInvariants(actions: ActionsFile): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  actions.events.forEach((event, index) => {
    if (event.target?.inputType === 'password' && event.metadata?.valueCaptured === true) {
      issues.push({
        path: `actions.events[${index}].metadata.valueCaptured`,
        code: 'password-value-captured',
        message: 'input type=password không bao giờ được capture value, không có override',
      })
    }
  })

  return issues
}

/**
 * Biến `privacy.json` từ một lời tuyên bố thành một lời tuyên bố **được kiểm
 * chứng**. Nếu policy nói "không capture body" mà body vẫn có mặt, capsule
 * không hợp lệ — bất kể producer khai gì.
 */
function privacyClaimInvariants(parts: {
  network?: NetworkFile
  state?: StateFile
  privacy: Privacy
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { policy } = parts.privacy
  const violation = (path: string, message: string): void => {
    issues.push({ path, code: 'privacy-claim-violated', message })
  }

  parts.network?.requests.forEach((request, index) => {
    for (const side of ['request', 'response'] as const) {
      const captured = request[side]

      if (!policy.bodyShapes && captured.bodyShape !== undefined) {
        violation(
          `network.requests[${index}].${side}.bodyShape`,
          `policy.bodyShapes=false nhưng ${side}.bodyShape có mặt`,
        )
      }

      const bodiesAllowed =
        side === 'request' ? policy.requestBodies : policy.responseBodies
      if (!bodiesAllowed && captured.body !== undefined) {
        violation(
          `network.requests[${index}].${side}.body`,
          `policy.${side === 'request' ? 'requestBodies' : 'responseBodies'}=false nhưng ${side}.body có mặt`,
        )
      }
    }

    if (!policy.queryValues) {
      for (const [key, value] of Object.entries(request.url.query)) {
        if (value !== REDACTED) {
          violation(
            `network.requests[${index}].url.query.${key}`,
            `policy.queryValues=false nhưng query "${key}" chưa được redact`,
          )
        }
      }
    }
  })

  if (!policy.storageValues && parts.state !== undefined) {
    for (const area of ['localStorage', 'sessionStorage'] as const) {
      parts.state[area].forEach((entry, index) => {
        if (entry.value !== undefined) {
          violation(
            `state.${area}[${index}].value`,
            `policy.storageValues=false nhưng value của "${entry.key}" có mặt`,
          )
        }
      })
    }
  }

  return issues
}

export function validateCapsule(
  parts: CapsuleParts,
  options: ValidateOptions = {},
): ValidationResult<ValidatedCapsule> {
  const issues: ValidationIssue[] = []
  const warnings: string[] = []

  const manifestResult = validateManifest(parts.manifest, options)
  warnings.push(...manifestResult.warnings)
  issues.push(
    ...manifestResult.issues.map((issue) => ({
      ...issue,
      path: issue.path === '' ? 'manifest' : `manifest.${issue.path}`,
    })),
  )

  if (!manifestResult.ok || manifestResult.value === undefined) {
    return { ok: false, issues, warnings }
  }

  const manifest = manifestResult.value
  const environment = validateOptionalFile(
    EnvironmentSchema,
    parts.environment,
    'environment',
    options,
    issues,
  )
  const actions = validateOptionalFile(ActionsFileSchema, parts.actions, 'actions', options, issues)
  const network = validateOptionalFile(NetworkFileSchema, parts.network, 'network', options, issues)
  const consoleFile = validateOptionalFile(
    ConsoleFileSchema,
    parts.console,
    'console',
    options,
    issues,
  )
  const state = validateOptionalFile(StateFileSchema, parts.state, 'state', options, issues)
  const privacy = validateOptionalFile(PrivacySchema, parts.privacy, 'privacy', options, issues)

  if (network !== undefined) issues.push(...bodyInvariants(network))
  if (actions !== undefined) issues.push(...actionInvariants(actions))
  if (privacy !== undefined) {
    issues.push(...privacyClaimInvariants({ network, state, privacy }))
  }

  if (issues.length > 0) return { ok: false, issues, warnings }

  return {
    ok: true,
    value: { manifest, environment, actions, network, console: consoleFile, state, privacy },
    issues,
    warnings,
  }
}
