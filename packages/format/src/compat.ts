/**
 * Hợp đồng tương thích giữa `formatVersion` của capsule và reader.
 *
 * spec §23 yêu cầu điều này phải **test được**, không phải "best effort" —
 * một format cho third party implement mà compatibility không kiểm chứng được
 * thì không phải contract.
 */

export const SUPPORTED_FORMAT_VERSION = '0.1.0'

type CompatLevel = 'supported' | 'forward-minor' | 'unsupported'

export interface CompatResult {
  level: CompatLevel
  reason: string
}

const SUPPORTED = { major: 0, minor: 1 } as const

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

export function checkCompatibility(capsuleVersion: string): CompatResult {
  const match = SEMVER.exec(capsuleVersion)
  if (match === null) {
    return {
      level: 'unsupported',
      reason: `formatVersion "${capsuleVersion}" không phải semver MAJOR.MINOR.PATCH`,
    }
  }

  const major = Number(match[1])
  const minor = Number(match[2])

  if (major !== SUPPORTED.major) {
    return {
      level: 'unsupported',
      reason: `formatVersion MAJOR ${major} khác MAJOR được hỗ trợ ${SUPPORTED.major}; reader không đoán ngược`,
    }
  }

  if (minor > SUPPORTED.minor) {
    return {
      level: 'forward-minor',
      reason: `capsule dùng MINOR ${minor} cao hơn ${SUPPORTED.minor}; field không nhận biết sẽ bị bỏ qua`,
    }
  }

  return { level: 'supported', reason: `tương thích với format ${SUPPORTED_FORMAT_VERSION}` }
}
