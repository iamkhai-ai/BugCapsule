import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { CapsuleWriteError, readCapsule, writeCapsule, type CapsuleArchive } from '../src/capsule'
import type { Environment } from '../src/environment'
import type { Manifest } from '../src/manifest'
import type { NetworkFile } from '../src/network'
import type { Privacy } from '../src/privacy'
import type { StateFile } from '../src/state'

const encoder = new TextEncoder()
const MTIME = new Date('2026-09-16T00:00:00Z')

const manifest: Manifest = {
  format: 'bugcapsule',
  formatVersion: '0.1.0',
  id: 'capsule_test',
  createdAt: '2026-09-16T00:00:00Z',
  source: { name: 'bugcapsule-test', version: '0.1.0' },
  role: 'broken',
  capture: {
    startedAt: '2026-09-16T00:00:00Z',
    endedAt: '2026-09-16T00:00:30Z',
    durationMs: 30000,
  },
}

const network: NetworkFile = {
  requests: [
    {
      id: 'req_01',
      docId: 'doc_1',
      frameId: 0,
      offsetMs: 5102,
      seq: 4,
      method: 'POST',
      url: {
        origin: 'https://api.example.com',
        pathname: '/api/checkout',
        query: { tab: 'payment', token: '<redacted>' },
      },
      resourceType: 'fetch',
      status: 500,
      durationMs: 321,
      request: {
        contentType: 'application/json',
        bodyCaptured: false,
        bodyShape: { type: 'object', properties: { quantity: { type: 'number' } } },
        omissionReason: 'disabled',
      },
      response: {
        contentType: 'application/json',
        bodyCaptured: false,
        omissionReason: 'disabled',
      },
    },
  ],
}

const state: StateFile = {
  localStorage: [{ key: 'feature_new_checkout', valueCaptured: false, valueType: 'boolean' }],
  sessionStorage: [],
  cookieNames: ['session'],
}

const privacy: Privacy = {
  policy: {
    queryValues: true,
    requestBodies: false,
    responseBodies: false,
    bodyShapes: true,
    storageValues: false,
    consoleVerbose: false,
  },
  redaction: {
    applied: true,
    removedFields: { headers: ['authorization'], queryKeys: ['token'], bodyPaths: [], storageKeys: [] },
  },
}

function validArchive(): CapsuleArchive {
  return { manifest: structuredClone(manifest), network, state, privacy }
}

/** Builds a raw zip, bypassing the writer — used to simulate a malicious or corrupt capsule. */
function rawZip(entries: Record<string, string | Uint8Array>): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 0 | 6; mtime: Date }]> = {}
  for (const [name, value] of Object.entries(entries)) {
    files[name] = [
      typeof value === 'string' ? encoder.encode(value) : value,
      { level: 6, mtime: MTIME },
    ]
  }
  return zipSync(files)
}

function entryInfo(bytes: Uint8Array): Record<string, { compressed: number; original: number }> {
  const info: Record<string, { compressed: number; original: number }> = {}
  unzipSync(bytes, {
    filter: (file) => {
      info[file.name] = { compressed: file.size, original: file.originalSize }
      return false
    },
  })
  return info
}

describe('writeCapsule', () => {
  it('produces a valid zip', () => {
    const bytes = writeCapsule(validArchive())
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('computes manifest.files from the entries actually present, trusting no caller claim', () => {
    const withoutShot = readCapsule(writeCapsule(validArchive()))
    expect(withoutShot.value?.manifest.files?.network).toBe('network.json')
    expect(withoutShot.value?.manifest.files?.screenshot).toBeUndefined()

    const withShot = readCapsule(
      writeCapsule({ ...validArchive(), screenshot: new Uint8Array([1, 2, 3]) }),
    )
    expect(withShot.value?.manifest.files?.screenshot).toBe('assets/screenshot.png')
  })

  it('compresses JSON but stores the screenshot because PNG is already compressed', () => {
    const environment: Environment = {
      browser: { name: 'Chrome', version: '128.0.0.0' },
      os: { name: 'Windows', version: '11' },
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
      build: 'x'.repeat(4000),
    }
    const bytes = writeCapsule({
      ...validArchive(),
      environment,
      screenshot: new Uint8Array(4096).fill(0xab),
    })
    const info = entryInfo(bytes)

    expect(info['environment.json']?.compressed).toBeLessThan(info['environment.json']?.original ?? 0)
    expect(info['assets/screenshot.png']?.compressed).toBe(info['assets/screenshot.png']?.original)
  })

  it('does not mutate the input archive', () => {
    const archive = validArchive()
    writeCapsule(archive)
    expect(archive.manifest.files).toBeUndefined()
  })

  it('rejects a capsule that violates the privacy claim', () => {
    const archive = validArchive()
    archive.network = {
      requests: [{ ...network.requests[0]!, request: { bodyCaptured: true, body: { type: 'json', value: 1 } } }],
    }
    expect(() => writeCapsule(archive)).toThrow(CapsuleWriteError)
  })

  it('rejects unknown fields — the producer must be strict, only the reader is permissive', () => {
    const archive = { ...validArchive(), futureField: 1 } as unknown as CapsuleArchive
    try {
      writeCapsule(archive)
      expect.unreachable('writeCapsule must reject unknown fields')
    } catch (error) {
      expect(error).toBeInstanceOf(CapsuleWriteError)
      expect((error as CapsuleWriteError).issues.map((issue) => issue.code)).toContain('unknown-field')
    }
  })

  it('writing twice yields identical bytes — required for reproducible fixtures', () => {
    expect(Array.from(writeCapsule(validArchive()))).toEqual(
      Array.from(writeCapsule(validArchive())),
    )
  })
})

describe('readCapsule', () => {
  it('reads back the manifest and network that were written', () => {
    const result = readCapsule(writeCapsule(validArchive()))
    expect(result.ok).toBe(true)
    expect(result.value?.manifest.id).toBe('capsule_test')
    expect(result.value?.manifest.role).toBe('broken')
    expect(result.value?.network).toEqual(network)
    expect(result.value?.state).toEqual(state)
  })

  it('returns the screenshot as bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    const result = readCapsule(writeCapsule({ ...validArchive(), screenshot: png }))
    expect(Array.from(result.value?.screenshot ?? [])).toEqual(Array.from(png))
  })

  it('rejects bytes that are not a zip', () => {
    const result = readCapsule(new Uint8Array([1, 2, 3, 4, 5]))
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('not-a-zip')
  })

  it('rejects entries containing .. to block zip slip', () => {
    const bytes = rawZip({
      'manifest.json': JSON.stringify(manifest),
      '../evil.json': '{"pwned":true}',
    })
    const result = readCapsule(bytes)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('unsafe-entry-path')
  })

  it('rejects entries with an absolute path', () => {
    const bytes = rawZip({
      'manifest.json': JSON.stringify(manifest),
      '/etc/passwd': 'root:x:0:0',
    })
    expect(readCapsule(bytes).issues.map((issue) => issue.code)).toContain('unsafe-entry-path')
  })

  it('rejects a zip bomb based on the size declared in the central directory', () => {
    const bytes = rawZip({
      'manifest.json': JSON.stringify(manifest),
      'bomb.json': new Uint8Array(8192),
    })
    const result = readCapsule(bytes, { limits: { maxTotalUncompressedBytes: 1024 } })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('capsule-too-large')
  })

  it('skips unknown entries with a warning, not an error', () => {
    const bytes = rawZip({
      'manifest.json': JSON.stringify(manifest),
      'notes.txt': 'notes from the sender',
    })
    const result = readCapsule(bytes)
    expect(result.ok).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('notes.txt'))).toBe(true)
  })

  it('rejects a missing manifest.json', () => {
    const result = readCapsule(rawZip({ 'network.json': JSON.stringify(network) }))
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('manifest-missing')
  })

  it('verifies the privacy claim on read, not only on write', () => {
    const bytes = rawZip({
      'manifest.json': JSON.stringify(manifest),
      'privacy.json': JSON.stringify(privacy),
      'network.json': JSON.stringify({
        requests: [
          {
            ...network.requests[0]!,
            request: { bodyCaptured: true, body: { type: 'json', value: { secret: 1 } } },
          },
        ],
      }),
    })
    const result = readCapsule(bytes)
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('privacy-claim-violated')
  })
})
