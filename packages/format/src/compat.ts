/**
 * Compatibility contract between a capsule's `formatVersion` and the reader.
 *
 * spec §23 requires this to be **testable**, not "best effort" — a format for
 * third parties to implement whose compatibility cannot be verified is not a
 * contract.
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
      reason: `formatVersion "${capsuleVersion}" is not semver MAJOR.MINOR.PATCH`,
    }
  }

  const major = Number(match[1])
  const minor = Number(match[2])

  if (major !== SUPPORTED.major) {
    return {
      level: 'unsupported',
      reason: `formatVersion MAJOR ${major} differs from the supported MAJOR ${SUPPORTED.major}; the reader does not guess backwards`,
    }
  }

  if (minor > SUPPORTED.minor) {
    return {
      level: 'forward-minor',
      reason: `capsule uses MINOR ${minor} higher than ${SUPPORTED.minor}; unrecognized fields will be ignored`,
    }
  }

  return { level: 'supported', reason: `compatible with format ${SUPPORTED_FORMAT_VERSION}` }
}
