import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCapsule, writeCapsule, type CapsuleArchive } from '@bugcapsule/format'
import { describe, expect, it } from 'vitest'
import { FIXTURES, buildCheckoutBroken, buildCheckoutWorking } from '../src/index'

function load(build: () => CapsuleArchive): CapsuleArchive {
  const result = readCapsule(writeCapsule(build()))
  if (!result.ok || result.value === undefined) {
    throw new Error(`fixture could not be read: ${JSON.stringify(result.issues)}`)
  }
  return result.value
}

function checkoutOf(archive: CapsuleArchive) {
  return archive.network?.requests.find((request) => request.url.pathname === '/api/checkout')
}

describe('fixture capsules', () => {
  it('every fixture reads back and is valid', () => {
    for (const fixture of FIXTURES) {
      const result = readCapsule(writeCapsule(fixture.archive))
      expect(result.issues, fixture.name).toEqual([])
      expect(result.ok, fixture.name).toBe(true)
    }
  })

  it('the checkout pair tells the story: 201 with orderId versus 500 with error', () => {
    const working = load(buildCheckoutWorking)
    const broken = load(buildCheckoutBroken)

    expect(checkoutOf(working)?.status).toBe(201)
    expect(checkoutOf(broken)?.status).toBe(500)
  })

  it('schema signal comes from bodyShape, because the body is NOT captured on either side', () => {
    const working = load(buildCheckoutWorking)
    const broken = load(buildCheckoutBroken)

    expect(working.privacy?.policy.responseBodies).toBe(false)
    expect(broken.privacy?.policy.responseBodies).toBe(false)
    expect(JSON.stringify(checkoutOf(working)?.response.bodyShape)).toContain('orderId')
    expect(JSON.stringify(checkoutOf(broken)?.response.bodyShape)).toContain('traceId')
  })

  it('the broken side has a console error that the working side does not', () => {
    expect(load(buildCheckoutWorking).console?.entries.some((e) => e.level === 'error')).toBe(false)
    expect(load(buildCheckoutBroken).console?.entries.some((e) => e.level === 'error')).toBe(true)
  })

  it('the broken side has a retry action that the working side does not', () => {
    expect(load(buildCheckoutBroken).actions?.events.length).toBeGreaterThan(
      load(buildCheckoutWorking).actions?.events.length ?? 0,
    )
  })

  it('the feature flag is inverted between the two sides', () => {
    const flagOf = (archive: CapsuleArchive) =>
      archive.state?.localStorage.find((entry) => entry.key === 'feature_new_checkout')?.value

    expect(flagOf(load(buildCheckoutWorking))).toBe(false)
    expect(flagOf(load(buildCheckoutBroken))).toBe(true)
  })

  it('no drift from the committed .bugcap — run: pnpm gen:fixtures', () => {
    for (const fixture of FIXTURES) {
      const committed = readFileSync(
        join(process.cwd(), 'fixtures', `${fixture.name}.bugcap`),
      )
      expect(
        Buffer.from(writeCapsule(fixture.archive)).equals(committed),
        `${fixture.name} drifted`,
      ).toBe(true)
    }
  })

  it('small enough to commit to git', () => {
    for (const fixture of FIXTURES) {
      expect(writeCapsule(fixture.archive).byteLength, fixture.name).toBeLessThan(20_000)
    }
  })
})
