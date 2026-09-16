import { unzipSync, zipSync, type Unzipped, type ZipOptions, type ZippableFile } from 'fflate'
import type { ActionsFile } from './actions'
import type { ConsoleFile } from './console'
import type { Environment } from './environment'
import type { Manifest, ManifestFiles } from './manifest'
import type { NetworkFile } from './network'
import type { Privacy } from './privacy'
import type { StateFile } from './state'
import {
  validateCapsule,
  type CapsuleParts,
  type ValidationIssue,
  type ValidationResult,
} from './validate'

/**
 * Tên entry cố định trong archive. Đây là một phần của format — đổi tên là
 * breaking change.
 */
export const CAPSULE_ENTRIES = {
  manifest: 'manifest.json',
  environment: 'environment.json',
  actions: 'actions.json',
  network: 'network.json',
  console: 'console.json',
  state: 'state.json',
  privacy: 'privacy.json',
  screenshot: 'assets/screenshot.png',
} as const

const OPTIONAL_FILE_KEYS = [
  'environment',
  'actions',
  'network',
  'console',
  'state',
  'privacy',
] as const

const CONTAINER_KEYS: readonly string[] = ['manifest', ...OPTIONAL_FILE_KEYS]

export interface CapsuleLimits {
  /** Giới hạn kích thước file .bugcap trên đĩa. */
  maxCapsuleBytes: number
  /**
   * Giới hạn tổng dung lượng **sau khi giải nén**. Đây là hàng rào zip bomb:
   * được kiểm tra từ central directory TRƯỚC khi giải nén byte nào.
   */
  maxTotalUncompressedBytes: number
}

export const DEFAULT_CAPSULE_LIMITS: CapsuleLimits = {
  maxCapsuleBytes: 10 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
}

export interface CapsuleArchive {
  manifest: Manifest
  environment?: Environment
  actions?: ActionsFile
  network?: NetworkFile
  console?: ConsoleFile
  state?: StateFile
  privacy?: Privacy
  screenshot?: Uint8Array
}

export interface ReadCapsuleOptions {
  limits?: Partial<CapsuleLimits>
}

/** Producer ghi ra capsule không hợp lệ là lỗi lập trình, không phải lỗi dữ liệu. */
export class CapsuleWriteError extends Error {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super(
      `capsule không hợp lệ: ${issues
        .map((issue) => `${issue.code}${issue.path === '' ? '' : ` tại ${issue.path}`}`)
        .join('; ')}`,
    )
    this.name = 'CapsuleWriteError'
    this.issues = issues
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function writeCapsule(archive: CapsuleArchive): Uint8Array {
  const raw = { ...(archive as unknown as Record<string, unknown>) }
  delete raw.screenshot

  const unknownKeys = Object.keys(raw).filter((key) => !CONTAINER_KEYS.includes(key))
  if (unknownKeys.length > 0) {
    throw new CapsuleWriteError(
      unknownKeys.map((key) => ({
        path: key,
        code: 'unknown-field',
        message: `field "${key}" không thuộc CapsuleArchive`,
      })),
    )
  }

  const validation = validateCapsule(raw as CapsuleParts, { strict: true })
  if (!validation.ok || validation.value === undefined) {
    throw new CapsuleWriteError(validation.issues)
  }

  // `files` luôn được TÍNH LẠI từ entry thực có, không nhận từ caller — nếu
  // nhận, manifest có thể khai một file không tồn tại.
  const files: ManifestFiles = {}
  if (archive.environment !== undefined) files.environment = CAPSULE_ENTRIES.environment
  if (archive.actions !== undefined) files.actions = CAPSULE_ENTRIES.actions
  if (archive.network !== undefined) files.network = CAPSULE_ENTRIES.network
  if (archive.console !== undefined) files.console = CAPSULE_ENTRIES.console
  if (archive.state !== undefined) files.state = CAPSULE_ENTRIES.state
  if (archive.privacy !== undefined) files.privacy = CAPSULE_ENTRIES.privacy
  if (archive.screenshot !== undefined) files.screenshot = CAPSULE_ENTRIES.screenshot

  // mtime lấy từ createdAt để cùng input cho ra cùng bytes — fixture tái lập được.
  const mtime = new Date(archive.manifest.createdAt)
  const jsonOptions: ZipOptions = { level: 6, mtime }
  const storedOptions: ZipOptions = { level: 0, mtime }

  const entries: Record<string, ZippableFile> = {}
  const addJson = (name: string, value: unknown): void => {
    entries[name] = [encodeJson(value), jsonOptions]
  }

  addJson(CAPSULE_ENTRIES.manifest, { ...archive.manifest, files })
  if (archive.environment !== undefined) addJson(CAPSULE_ENTRIES.environment, archive.environment)
  if (archive.actions !== undefined) addJson(CAPSULE_ENTRIES.actions, archive.actions)
  if (archive.network !== undefined) addJson(CAPSULE_ENTRIES.network, archive.network)
  if (archive.console !== undefined) addJson(CAPSULE_ENTRIES.console, archive.console)
  if (archive.state !== undefined) addJson(CAPSULE_ENTRIES.state, archive.state)
  if (archive.privacy !== undefined) addJson(CAPSULE_ENTRIES.privacy, archive.privacy)

  // PNG đã nén sẵn: deflate lại chỉ làm file to thêm.
  if (archive.screenshot !== undefined) {
    entries[CAPSULE_ENTRIES.screenshot] = [archive.screenshot, storedOptions]
  }

  return zipSync(entries)
}

/**
 * Đường dẫn entry an toàn.
 *
 * Capsule là **untrusted input**: nó đến từ người khác qua chat hoặc email.
 * Một entry `../../.ssh/authorized_keys` hoặc `/etc/passwd` phải bị từ chối
 * trước khi bất cứ thứ gì được ghi ra đĩa.
 */
function isSafeEntryPath(name: string): boolean {
  if (name === '') return false
  if (/[\u0000-\u001f]/.test(name)) return false
  if (name.startsWith('/') || name.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(name)) return false
  if (name.includes('\\')) return false

  const segments = name.split('/').filter((segment) => segment !== '')
  return !segments.includes('..')
}

interface DirectoryEntry {
  name: string
  original: number
}

export function readCapsule(
  bytes: Uint8Array,
  options: ReadCapsuleOptions = {},
): ValidationResult<CapsuleArchive> {
  const limits: CapsuleLimits = { ...DEFAULT_CAPSULE_LIMITS, ...options.limits }
  const issues: ValidationIssue[] = []
  const warnings: string[] = []

  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return {
      ok: false,
      issues: [{ path: '', code: 'not-a-zip', message: 'bytes không bắt đầu bằng chữ ký zip' }],
      warnings,
    }
  }

  if (bytes.byteLength > limits.maxCapsuleBytes) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          code: 'capsule-too-large',
          message: `capsule ${bytes.byteLength} byte vượt giới hạn ${limits.maxCapsuleBytes} byte`,
        },
      ],
      warnings,
    }
  }

  // Lượt 1: chỉ đọc central directory, KHÔNG giải nén entry nào.
  const directory: DirectoryEntry[] = []
  try {
    unzipSync(bytes, {
      filter: (file) => {
        directory.push({ name: file.name, original: file.originalSize })
        return false
      },
    })
  } catch (error) {
    return {
      ok: false,
      issues: [
        { path: '', code: 'not-a-zip', message: `không đọc được zip: ${describeError(error)}` },
      ],
      warnings,
    }
  }

  for (const entry of directory) {
    if (!isSafeEntryPath(entry.name)) {
      issues.push({
        path: entry.name,
        code: 'unsafe-entry-path',
        message: `entry "${entry.name}" có đường dẫn không an toàn và bị từ chối`,
      })
    }
  }
  if (issues.length > 0) return { ok: false, issues, warnings }

  const totalOriginal = directory.reduce((sum, entry) => sum + entry.original, 0)
  if (totalOriginal > limits.maxTotalUncompressedBytes) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          code: 'capsule-too-large',
          message: `tổng dung lượng giải nén ${totalOriginal} byte vượt giới hạn ${limits.maxTotalUncompressedBytes} byte`,
        },
      ],
      warnings,
    }
  }

  // Lượt 2: chỉ giải nén entry thuộc format.
  const wanted = new Set<string>(Object.values(CAPSULE_ENTRIES))
  let extracted: Unzipped
  try {
    extracted = unzipSync(bytes, { filter: (file) => wanted.has(file.name) })
  } catch (error) {
    return {
      ok: false,
      issues: [
        { path: '', code: 'not-a-zip', message: `không giải nén được: ${describeError(error)}` },
      ],
      warnings,
    }
  }

  for (const entry of directory) {
    if (entry.name.endsWith('/')) continue
    if (!wanted.has(entry.name)) {
      warnings.push(`bỏ qua entry không thuộc format v0.1: ${entry.name}`)
    }
  }

  const jsonIssues: ValidationIssue[] = []
  const readJson = (name: string): unknown => {
    const raw: Uint8Array | undefined = extracted[name]
    if (raw === undefined) return undefined
    try {
      return JSON.parse(new TextDecoder().decode(raw)) as unknown
    } catch (error) {
      jsonIssues.push({
        path: name,
        code: 'invalid-json',
        message: `${name} không phải JSON hợp lệ: ${describeError(error)}`,
      })
      return undefined
    }
  }

  const parts: CapsuleParts = {}
  parts.manifest = readJson(CAPSULE_ENTRIES.manifest)

  if (parts.manifest === undefined && jsonIssues.length === 0) {
    return {
      ok: false,
      issues: [
        {
          path: CAPSULE_ENTRIES.manifest,
          code: 'manifest-missing',
          message: 'capsule thiếu manifest.json',
        },
      ],
      warnings,
    }
  }

  parts.environment = readJson(CAPSULE_ENTRIES.environment)
  parts.actions = readJson(CAPSULE_ENTRIES.actions)
  parts.network = readJson(CAPSULE_ENTRIES.network)
  parts.console = readJson(CAPSULE_ENTRIES.console)
  parts.state = readJson(CAPSULE_ENTRIES.state)
  parts.privacy = readJson(CAPSULE_ENTRIES.privacy)

  if (jsonIssues.length > 0) return { ok: false, issues: jsonIssues, warnings }

  const validation = validateCapsule(parts)
  const allWarnings = [...warnings, ...validation.warnings]

  if (!validation.ok || validation.value === undefined) {
    return { ok: false, issues: validation.issues, warnings: allWarnings }
  }

  const screenshot: Uint8Array | undefined = extracted[CAPSULE_ENTRIES.screenshot]
  return {
    ok: true,
    value:
      screenshot === undefined ? validation.value : { ...validation.value, screenshot },
    issues: [],
    warnings: allWarnings,
  }
}
