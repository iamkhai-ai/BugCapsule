# BugCapsule Extension Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, browser-free core of the BugCapsule capture extension, so that synthetic capture records become a valid `.bugcap` — including the single function that enforces the privacy claim.

**Architecture:** `packages/extension/src/core/` holds every decision the extension makes. Nothing in it references `chrome.*`, the DOM, or a timer, so all of it is unit-testable with plain data. `src/probe.main.ts`, `src/bridge.isolated.ts`, `src/sw.ts` and `src/offscreen.ts` (Plan 2) are thin adapters that observe the world and hand plain records to this core.

**Tech Stack:** TypeScript 5.9.3, Vite 7.3.6 (Plan 2), vitest 5.0.0, `@bugcapsule/format` (zod 4 schemas are the single source of truth for every shape).

**Spec:** `docs/design/2026-09-16-extension-capture-design.md` — read §5, §7, §8 and §11 before starting; the tasks below implement them and argue from them.

## Global Constraints

- Node `>= 22.12.0`; developed on `24.19.0`. pnpm `11.8.0`.
- `minimumReleaseAge: 1440` is declared in `pnpm-workspace.yaml` — do not add a dependency published within the last 24 hours.
- `@bugcapsule/format` is the **only** source of schema, types and shape logic. Never redefine a shape, a field name or a `BodyShape`. Import `valueToBodyShape`, `BodyShape`, `UrlRef`, `EventBase`, `REDACTED`, `CapsuleArchive`, `writeCapsule`, `readCapsule`, `validateCapsule` from it.
- Packages use source-only exports (`"exports": { ".": "./src/index.ts" }`) — no build step for workspace packages. Vitest and Vite consume TypeScript directly.
- All files LF. `.gitattributes` enforces `* text=auto eol=lf`.
- **Zero Vietnamese characters** anywhere in the repository (the only permitted exception is the author's name in the README copyright line).
- Git author for every commit: `Nguyễn Quang Khải <nqkhai.uet@gmail.com>`.
- **TDD is mandatory.** Write the failing test, run it, see it fail, then implement.
- Commit by **explicit path**. Never `git add -A`.
- The extension must never use `chrome.debugger` (decision D1).
- Real capsules are non-deterministic; the byte-determinism guarantee applies to the committed fixtures only. Do not "fix" a real capsule's timestamp to make a test pass.
- **No value ever leaves the page context.** The only permitted exit from the probe is `toBridgePayload` (Task 3). Nothing else in this package may construct a payload for the bridge.

## File Structure

| File | Responsibility |
|---|---|
| `packages/extension/package.json` | Package manifest, private, source-only exports |
| `packages/extension/tsconfig.json` | Extends the workspace base config |
| `packages/extension/src/core/caps.ts` | The five capture limits, in one place, as numbers |
| `packages/extension/src/core/buffer.ts` | `EventRing` — per-kind caps, total cap, 30 s window, freeze |
| `packages/extension/src/core/redact.ts` | Denylist matching, fail-closed |
| `packages/extension/src/core/url.ts` | Raw URL → `UrlRef` with query-key redaction |
| `packages/extension/src/core/exit.ts` | **The privacy boundary.** `toBridgePayload` |
| `packages/extension/src/core/selector.ts` | Element → selector, with the strategy that produced it |
| `packages/extension/src/core/action.ts` | Raw interaction → `ActionEvent`, including the password invariant |
| `packages/extension/src/core/network.ts` | Raw request → `NetworkRequest`, including `omissionReason` |
| `packages/extension/src/core/console.ts` | Raw console call → `ConsoleEntry`, with bounded serialization |
| `packages/extension/src/core/environment.ts` | Raw environment observations → `Environment` |
| `packages/extension/src/core/state.ts` | Storage snapshot → `StateFile` |
| `packages/extension/src/core/privacy.ts` | Redaction ledger → `Privacy`, plus `createExitPolicy` |
| `packages/extension/src/core/gaps.ts` | The `captureGaps` code set |
| `packages/extension/src/core/archive.ts` | Everything → `CapsuleArchive` |

Each file has one responsibility and no file imports a sibling's internals. `exit.ts` is the only module allowed to know about all the others.

---

### Task 1: Package scaffold, capture limits, and the event ring

**Files:**
- Create: `packages/extension/package.json`
- Create: `packages/extension/tsconfig.json`
- Create: `packages/extension/src/core/caps.ts`
- Create: `packages/extension/src/core/buffer.ts`
- Test: `packages/extension/test/buffer.test.ts`

**Interfaces:**
- Consumes: nothing (this is the first task).
- Produces: `BufferCaps`, `DEFAULT_CAPS`; `EventKind = 'network' | 'console' | 'action'`; `BufferedEvent = { kind: EventKind; offsetMs: number; seq: number; payload: unknown }`; `class EventRing` with `constructor(caps?: BufferCaps)`, `push(kind: EventKind, payload: unknown, offsetMs: number): void`, `freeze(atMs: number): BufferedEvent[]`, `get size(): number`.

- [ ] **Step 1: Create the package manifest**

`packages/extension/package.json`:

```json
{
  "name": "@bugcapsule/extension",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/core/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@bugcapsule/format": "workspace:*"
  }
}
```

`packages/extension/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Read the repository's existing `packages/format/tsconfig.json` and `packages/format/package.json` first and copy their structure exactly — do not invent a different base config path. If the base config file has a different name, use that name.

- [ ] **Step 2: Write the failing test for the caps and the ring**

`packages/extension/test/buffer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CAPS } from '../src/core/caps'
import { EventRing } from '../src/core/buffer'

describe('DEFAULT_CAPS', () => {
  it('matches the limits frozen in the spec', () => {
    expect(DEFAULT_CAPS.total).toBe(500)
    expect(DEFAULT_CAPS.network).toBe(200)
    expect(DEFAULT_CAPS.console).toBe(200)
    expect(DEFAULT_CAPS.action).toBe(100)
    expect(DEFAULT_CAPS.windowMs).toBe(30_000)
  })
})

describe('EventRing', () => {
  it('assigns increasing seq numbers across kinds', () => {
    const ring = new EventRing()
    ring.push('network', { a: 1 }, 0)
    ring.push('console', { b: 2 }, 1)
    const frozen = ring.freeze(1)
    expect(frozen.map((e) => e.seq)).toEqual([0, 1])
  })

  it('evicts the oldest event of a kind when that kind is full', () => {
    const ring = new EventRing({ ...DEFAULT_CAPS, network: 2, total: 100 })
    ring.push('network', 'first', 0)
    ring.push('network', 'second', 1)
    ring.push('network', 'third', 2)
    expect(ring.freeze(2).map((e) => e.payload)).toEqual(['second', 'third'])
  })

  it('evicts the oldest event overall when the total cap is reached', () => {
    const ring = new EventRing({ ...DEFAULT_CAPS, total: 2, network: 10, console: 10, action: 10 })
    ring.push('network', 'a', 0)
    ring.push('console', 'b', 1)
    ring.push('action', 'c', 2)
    expect(ring.freeze(2).map((e) => e.payload)).toEqual(['b', 'c'])
  })

  it('drops events older than the window relative to the newest event', () => {
    const ring = new EventRing({ ...DEFAULT_CAPS, windowMs: 100 })
    ring.push('network', 'old', 0)
    ring.push('network', 'new', 150)
    expect(ring.freeze(150).map((e) => e.payload)).toEqual(['new'])
  })

  it('freezes only events inside the window ending at the freeze instant', () => {
    const ring = new EventRing({ ...DEFAULT_CAPS, windowMs: 100 })
    ring.push('network', 'before', 0)
    ring.push('network', 'inside', 80)
    expect(ring.freeze(100).map((e) => e.payload)).toEqual(['inside'])
  })

  it('returns a frozen snapshot that later pushes cannot change', () => {
    const ring = new EventRing()
    ring.push('network', 'a', 0)
    const frozen = ring.freeze(0)
    ring.push('network', 'b', 1)
    expect(frozen).toHaveLength(1)
  })

  it('keeps events of different kinds independently capped', () => {
    const ring = new EventRing({ ...DEFAULT_CAPS, console: 1 })
    ring.push('network', 'n1', 0)
    ring.push('console', 'c1', 1)
    ring.push('console', 'c2', 2)
    expect(ring.freeze(2).map((e) => e.payload)).toEqual(['n1', 'c2'])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @bugcapsule/extension test`
Expected: FAIL — the modules `../src/core/caps` and `../src/core/buffer` do not exist.

- [ ] **Step 4: Implement the caps**

`packages/extension/src/core/caps.ts`:

```ts
/**
 * Capture limits, taken verbatim from spec §15 and §8.
 *
 * These are deliberately plain numbers in one file: every one of them is a
 * promise made in the specification, and a promise is easier to check when it
 * exists in exactly one place.
 */
export interface BufferCaps {
  /** Hard ceiling on events of all kinds together. */
  total: number
  network: number
  console: number
  action: number
  /** Only events this recent, relative to the newest event, are retained. */
  windowMs: number
}

export const DEFAULT_CAPS: BufferCaps = {
  total: 500,
  network: 200,
  console: 200,
  action: 100,
  windowMs: 30_000,
}
```

- [ ] **Step 5: Implement the ring**

`packages/extension/src/core/buffer.ts`:

```ts
import { DEFAULT_CAPS, type BufferCaps } from './caps'

export type EventKind = 'network' | 'console' | 'action'

export interface BufferedEvent {
  kind: EventKind
  offsetMs: number
  seq: number
  payload: unknown
}

const KINDS: readonly EventKind[] = ['network', 'console', 'action']

/**
 * A bounded ring of capture events.
 *
 * There is no start and no stop: events accumulate from document_start and the
 * buffer holds the most recent window. `freeze` is the only way to read, and it
 * returns a snapshot, so a capture cannot be mutated by events that arrive
 * while it is being written.
 */
export class EventRing {
  private events: BufferedEvent[] = []
  private nextSeq = 0

  constructor(private readonly caps: BufferCaps = DEFAULT_CAPS) {}

  get size(): number {
    return this.events.length
  }

  push(kind: EventKind, payload: unknown, offsetMs: number): void {
    this.events.push({ kind, offsetMs, seq: this.nextSeq++, payload })
    this.evict(offsetMs)
  }

  freeze(atMs: number): BufferedEvent[] {
    const floor = atMs - this.caps.windowMs
    return this.events.filter((e) => e.offsetMs > floor && e.offsetMs <= atMs)
  }

  private evict(newestMs: number): void {
    const floor = newestMs - this.caps.windowMs
    this.events = this.events.filter((event) => event.offsetMs > floor)

    for (const kind of KINDS) {
      const limit = this.caps[kind]
      const kept: BufferedEvent[] = []
      let seen = 0
      for (let i = this.events.length - 1; i >= 0; i--) {
        const event = this.events[i]!
        if (event.kind !== kind) {
          kept.push(event)
          continue
        }
        seen++
        if (seen <= limit) kept.push(event)
      }
      this.events = kept.reverse()
    }

    if (this.events.length > this.caps.total) {
      this.events = this.events.slice(this.events.length - this.caps.total)
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test`
Expected: PASS, 8 tests.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @bugcapsule/extension typecheck`
Expected: exit 0, no output.

- [ ] **Step 8: Commit**

```bash
git add packages/extension/package.json packages/extension/tsconfig.json \
  packages/extension/src/core/caps.ts packages/extension/src/core/buffer.ts \
  packages/extension/test/buffer.test.ts pnpm-lock.yaml
git commit -m "feat(extension): add the bounded event ring"
```

---

### Task 2: Denylist redaction and URL references

**Files:**
- Create: `packages/extension/src/core/redact.ts`
- Create: `packages/extension/src/core/url.ts`
- Test: `packages/extension/test/redact.test.ts`
- Test: `packages/extension/test/url.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `DENY_SUBSTRINGS: readonly string[]`; `normalizeKey(key: string): string`; `isDeniedKey(key: string): boolean`; `UrlRedaction = { url: UrlRef; redactedQueryKeys: string[] }`; `toUrlRef(raw: string, isDenied?: (key: string) => boolean): UrlRedaction | null`.

- [ ] **Step 1: Write the failing test for redaction**

`packages/extension/test/redact.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isDeniedKey, normalizeKey } from '../src/core/redact'

describe('normalizeKey', () => {
  it('lowercases and strips separators', () => {
    expect(normalizeKey('X-Auth-Token')).toBe('xauthtoken')
    expect(normalizeKey('access_token')).toBe('accesstoken')
    expect(normalizeKey('API KEY')).toBe('apikey')
  })
})

describe('isDeniedKey', () => {
  it('denies keys that name a credential', () => {
    for (const key of [
      'token',
      'access_token',
      'X-Auth-Token',
      'authorization',
      'password',
      'passwd',
      'api_key',
      'apiKey',
      'secret',
      'sessionId',
      'csrf',
      'XSRF-TOKEN',
      'jwt',
      'bearer',
      'credential',
      'otp',
    ]) {
      expect(isDeniedKey(key), key).toBe(true)
    }
  })

  it('keeps ordinary keys, so the capsule stays useful', () => {
    for (const key of ['tab', 'page', 'settings', 'id', 'lang', 'q', 'filter', 'sort', 'limit']) {
      expect(isDeniedKey(key), key).toBe(false)
    }
  })

  it('over-redacts rather than under-redacts', () => {
    // `author` is not a credential, but it shares a prefix with one. Redacting
    // a harmless key costs a debugger a little context; failing to redact a
    // credential costs the user their session. The trade is deliberate.
    expect(isDeniedKey('author')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bugcapsule/extension test redact`
Expected: FAIL — `../src/core/redact` does not exist.

- [ ] **Step 3: Implement redaction**

`packages/extension/src/core/redact.ts`:

```ts
/**
 * Key denylist.
 *
 * Matching is substring-based on a normalized key (lowercased, separators
 * removed) rather than exact-match, and it deliberately over-redacts. The
 * asymmetry is the whole point: redacting `author` costs a debugger a little
 * context, while missing `X-Auth-Token` costs the user a session. When the two
 * failure modes differ that much, the rule should fail in the cheap direction.
 */
export const DENY_SUBSTRINGS: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'auth',
  'credential',
  'session',
  'cookie',
  'csrf',
  'xsrf',
  'jwt',
  'bearer',
  'signature',
  'otp',
  'privatekey',
  'passcode',
]

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isDeniedKey(key: string): boolean {
  const normalized = normalizeKey(key)
  if (normalized === '') return false
  return DENY_SUBSTRINGS.some((needle) => normalized.includes(needle))
}
```

- [ ] **Step 4: Run the redaction tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test redact`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for URL references**

`packages/extension/test/url.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { REDACTED } from '@bugcapsule/format'
import { toUrlRef } from '../src/core/url'

describe('toUrlRef', () => {
  it('splits an absolute URL into origin, pathname and query', () => {
    const result = toUrlRef('https://shop.example.com/api/cart?tab=settings')
    expect(result?.url).toEqual({
      origin: 'https://shop.example.com',
      pathname: '/api/cart',
      query: { tab: 'settings' },
    })
  })

  it('keeps a non-sensitive value, because a capsule full of redactions is useless', () => {
    expect(toUrlRef('https://x.test/a?tab=settings')?.url.query.tab).toBe('settings')
  })

  it('redacts a sensitive value and records the key', () => {
    const result = toUrlRef('https://x.test/a?token=abc123&tab=settings')
    expect(result?.url.query.token).toBe(REDACTED)
    expect(result?.redactedQueryKeys).toEqual(['token'])
  })

  it('does not leak the secret anywhere in the result', () => {
    const result = toUrlRef('https://x.test/a?api_key=SUPERSECRET')
    expect(JSON.stringify(result)).not.toContain('SUPERSECRET')
  })

  it('reports every redacted key when several are present', () => {
    const result = toUrlRef('https://x.test/a?token=t&session=s&tab=ok')
    expect(result?.redactedQueryKeys.sort()).toEqual(['session', 'token'])
    expect(result?.url.query.tab).toBe('ok')
  })

  it('keeps a bare query key with no value', () => {
    expect(toUrlRef('https://x.test/a?debug')?.url.query).toEqual({ debug: '' })
  })

  it('returns null for a URL it cannot parse, rather than guessing', () => {
    expect(toUrlRef('not a url')).toBeNull()
    expect(toUrlRef('')).toBeNull()
  })

  it('accepts an injected predicate so callers can extend the denylist', () => {
    const result = toUrlRef('https://x.test/a?custom=1', (key) => key === 'custom')
    expect(result?.url.query.custom).toBe(REDACTED)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @bugcapsule/extension test url`
Expected: FAIL — `../src/core/url` does not exist.

- [ ] **Step 7: Implement URL references**

`packages/extension/src/core/url.ts`:

```ts
import { REDACTED, type UrlRef } from '@bugcapsule/format'
import { isDeniedKey } from './redact'

export interface UrlRedaction {
  url: UrlRef
  redactedQueryKeys: string[]
}

/**
 * Raw URL to a `UrlRef`, keeping non-sensitive query values.
 *
 * A capsule whose every query value is `<redacted>` cannot answer "which tab
 * was open", which is a common and harmless question. So values are kept by
 * default and dropped by key pattern.
 *
 * Returns `null` when the URL cannot be parsed. The caller must then drop the
 * record and declare a capture gap: inventing an origin would put a fabricated
 * fact into the capsule, and a fabricated fact is worse than a missing one.
 */
export function toUrlRef(raw: string, isDenied: (key: string) => boolean = isDeniedKey): UrlRedaction | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  if (parsed.origin === 'null') return null

  const query: Record<string, string> = {}
  const redactedQueryKeys: string[] = []

  for (const [key, value] of parsed.searchParams) {
    if (isDenied(key)) {
      query[key] = REDACTED
      if (!redactedQueryKeys.includes(key)) redactedQueryKeys.push(key)
    } else {
      query[key] = value
    }
  }

  return {
    url: { origin: parsed.origin, pathname: parsed.pathname, query },
    redactedQueryKeys,
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test`
Expected: PASS, all tests from Tasks 1 and 2.

- [ ] **Step 9: Commit**

```bash
git add packages/extension/src/core/redact.ts packages/extension/src/core/url.ts \
  packages/extension/test/redact.test.ts packages/extension/test/url.test.ts
git commit -m "feat(extension): add denylist redaction and UrlRef construction"
```

---

### Task 3: The privacy boundary

This is the most important task in the plan. Everything else can be fixed later; a leak here cannot be un-shipped.

**Files:**
- Create: `packages/extension/src/core/exit.ts`
- Test: `packages/extension/test/exit.test.ts`

**Interfaces:**
- Consumes: `toUrlRef` (Task 2), `isDeniedKey` (Task 2), `EventKind` (Task 1).
- Produces: `ExitPolicy` (the six booleans, named exactly as `spec/0.1/privacy.schema.json`); `ProbeRecord` (a discriminated union of raw observations); `BridgePayload` (a discriminated union of what may cross); `toBridgePayload(record: ProbeRecord, policy: ExitPolicy): BridgePayload | null`.

- [ ] **Step 1: Write the failing test — the property that matters**

`packages/extension/test/exit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { REDACTED } from '@bugcapsule/format'
import { toBridgePayload, type ExitPolicy, type ProbeRecord } from '../src/core/exit'

const SECRET = 'SUPER-SECRET-VALUE-9f3a'

const policy: ExitPolicy = {
  queryValues: true,
  requestBodies: false,
  responseBodies: false,
  bodyShapes: true,
  storageValues: false,
  consoleVerbose: false,
}

function record(partial: Partial<ProbeRecord> & { kind: ProbeRecord['kind'] }): ProbeRecord {
  return {
    id: 'e1',
    docId: 'd1',
    frameId: 0,
    offsetMs: 10,
    ...partial,
  } as ProbeRecord
}

describe('toBridgePayload never emits a value', () => {
  const records: ProbeRecord[] = [
    record({
      kind: 'network',
      method: 'POST',
      urlRaw: `https://x.test/api?token=${SECRET}`,
      status: 200,
      durationMs: 12,
      resourceType: 'fetch',
      requestContentType: 'application/json',
      requestBody: { password: SECRET, user: 'ada' },
      responseContentType: 'application/json',
      responseBody: { session: SECRET, ok: true },
    }),
    record({
      kind: 'console',
      level: 'log',
      args: [{ secret: SECRET }, SECRET],
      stack: undefined,
      origin: 'page',
    }),
    record({
      kind: 'action',
      type: 'input',
      element: { tagName: 'INPUT', id: 'pw', getAttribute: () => null, parentElement: null },
      inputType: 'password',
      value: SECRET,
      url: `https://x.test/form?token=${SECRET}`,
    }),
    record({
      kind: 'storage',
      localStorage: { token: SECRET, theme: SECRET },
      sessionStorage: {},
      cookieNames: ['session', SECRET],
    }),
  ]

  it.each(records.map((r) => [r.kind, r] as const))('%s', (_kind, input) => {
    const payload = toBridgePayload(input, policy)
    expect(payload).not.toBeNull()
    expect(JSON.stringify(payload)).not.toContain(SECRET)
  })

  it('checks the union as a whole, so a new record kind cannot quietly bypass the rule', () => {
    const serialized = records.map((r) => JSON.stringify(toBridgePayload(r, policy))).join('\n')
    expect(serialized).not.toContain(SECRET)
  })
})

describe('toBridgePayload carries the shape', () => {
  it('emits a bodyShape for a JSON response while emitting no body', () => {
    const payload = toBridgePayload(
      record({
        kind: 'network',
        method: 'GET',
        urlRaw: 'https://x.test/api',
        status: 200,
        durationMs: 5,
        resourceType: 'fetch',
        responseContentType: 'application/json',
        responseBody: { ok: true, count: 2 },
      }),
      policy,
    )
    expect(payload).toMatchObject({
      kind: 'network',
      response: { bodyCaptured: false, bodyShape: { type: 'object' } },
    })
    expect(JSON.stringify(payload)).not.toContain('"body"')
  })

  it('omits the shape entirely when policy.bodyShapes is false', () => {
    const payload = toBridgePayload(
      record({
        kind: 'network',
        method: 'GET',
        urlRaw: 'https://x.test/api',
        status: 200,
        durationMs: 5,
        resourceType: 'fetch',
        responseContentType: 'application/json',
        responseBody: { ok: true },
      }),
      { ...policy, bodyShapes: false },
    )
    expect(JSON.stringify(payload)).not.toContain('bodyShape')
  })

  it('records a redacted query key by name', () => {
    const payload = toBridgePayload(
      record({
        kind: 'network',
        method: 'GET',
        urlRaw: 'https://x.test/api?token=abc&tab=settings',
        status: 200,
        durationMs: 5,
        resourceType: 'fetch',
      }),
      policy,
    )
    expect(payload).toMatchObject({ kind: 'network', redactedQueryKeys: ['token'] })
  })
})

describe('toBridgePayload refuses what it cannot render', () => {
  it('returns null for an unparseable URL instead of inventing one', () => {
    const payload = toBridgePayload(
      record({
        kind: 'network',
        method: 'GET',
        urlRaw: 'nonsense',
        status: 200,
        durationMs: 1,
        resourceType: 'fetch',
      }),
      policy,
    )
    expect(payload).toBeNull()
  })

  it('sends no storage value by default, and a value only when asked', () => {
    const input = record({
      kind: 'storage',
      localStorage: { theme: 'dark' },
      sessionStorage: {},
      cookieNames: [],
    })
    expect(JSON.stringify(toBridgePayload(input, policy))).not.toContain('dark')
    expect(JSON.stringify(toBridgePayload(input, { ...policy, storageValues: true }))).toContain('dark')
  })

  it('never sends a cookie value, even when storageValues is true', () => {
    const input = record({
      kind: 'storage',
      localStorage: {},
      sessionStorage: {},
      cookieNames: ['sid'],
    })
    const payload = toBridgePayload(input, { ...policy, storageValues: true })
    expect(payload).toMatchObject({ kind: 'storage', cookieNames: ['sid'] })
  })

  it('sends console argument objects only when consoleVerbose is true', () => {
    const input = record({ kind: 'console', level: 'log', args: [{ deep: { nested: 'v' } }], origin: 'page' })
    expect(toBridgePayload(input, policy)).toMatchObject({ kind: 'console', args: [] })
    const verbose = toBridgePayload(input, { ...policy, consoleVerbose: true })
    expect(JSON.stringify(verbose)).toContain('nested')
  })
})

describe('REDACTED is what a suppressed value becomes', () => {
  it('uses the format constant rather than a private spelling', () => {
    const payload = toBridgePayload(
      record({
        kind: 'network',
        method: 'GET',
        urlRaw: 'https://x.test/a?password=x',
        status: 200,
        durationMs: 1,
        resourceType: 'fetch',
      }),
      policy,
    )
    expect(JSON.stringify(payload)).toContain(REDACTED)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bugcapsule/extension test exit`
Expected: FAIL — `../src/core/exit` does not exist.

- [ ] **Step 3: Implement the boundary**

`packages/extension/src/core/exit.ts`:

```ts
import { valueToBodyShape, valueTypeOf, type BodyShape } from '@bugcapsule/format'
import { toUrlRef, type UrlRedaction } from './url'

/** The value-type vocabulary, taken from the format rather than restated here. */
type StorageValueType = ReturnType<typeof valueTypeOf>

/**
 * The six policy booleans, named exactly as `spec/0.1/privacy.schema.json`.
 * Keeping the names identical to the format means a policy object can be
 * written straight into `privacy.json` with no translation layer.
 */
export interface ExitPolicy {
  queryValues: boolean
  requestBodies: boolean
  responseBodies: boolean
  bodyShapes: boolean
  storageValues: boolean
  consoleVerbose: boolean
}

export interface RecordBase {
  id: string
  docId: string
  frameId: number
  offsetMs: number
}

/** A minimal structural view of an element. No DOM type is imported here. */
export interface ElementView {
  tagName: string
  id?: string
  getAttribute(name: string): string | null
  parentElement: ElementView | null
}

export type ProbeRecord =
  | (RecordBase & {
      kind: 'network'
      method: string
      urlRaw: string
      status: number
      durationMs: number
      resourceType: 'fetch' | 'xhr'
      requestContentType?: string
      requestBody?: unknown
      responseContentType?: string
      responseBody?: unknown
      readFailed?: boolean
    })
  | (RecordBase & { kind: 'console'; level: string; args: unknown[]; stack?: string; origin: 'page' | 'extension' | 'unknown' })
  | (RecordBase & {
      kind: 'action'
      type: string
      element: ElementView | null
      inputType?: string
      value?: unknown
      url?: string
    })
  | (RecordBase & { kind: 'storage'; localStorage: Record<string, unknown>; sessionStorage: Record<string, unknown>; cookieNames: string[] })

export interface BodySide {
  contentType?: string
  bodyCaptured: boolean
  bodyShape?: BodyShape
}

export type BridgePayload =
  | (RecordBase & {
      kind: 'network'
      method: string
      url: { origin: string; pathname: string; query: Record<string, string> }
      redactedQueryKeys: string[]
      status: number
      durationMs: number
      resourceType: 'fetch' | 'xhr'
      request: BodySide
      response: BodySide
    })
  | (RecordBase & { kind: 'console'; level: string; message: string; args: string[]; stack?: string; origin: 'page' | 'extension' | 'unknown' })
  | (RecordBase & {
      kind: 'action'
      type: string
      selector: string | null
      strategy: string | null
      tag: string | null
      inputType?: string
      valueCaptured: boolean
      valueLength?: number
      url?: string
      redactedQueryKeys: string[]
    })
  | (RecordBase & {
      kind: 'storage'
      localStorage: Array<{ key: string; valueType: StorageValueType; value?: unknown }>
      sessionStorage: Array<{ key: string; valueType: StorageValueType; value?: unknown }>
      cookieNames: string[]
    })

const SIZE_LIMIT = 64 * 1024

function serializeArg(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'undefined') return String(value)
  if (typeof value === 'function') return '[function]'
  try {
    const seen = new WeakSet<object>()
    const text = JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v as object)) return '[circular]'
        seen.add(v as object)
      }
      return v
    })
    return text === undefined ? String(value) : text
  } catch {
    return '[unserializable]'
  }
}

function toBodySide(body: unknown, contentType: string | undefined, enabled: boolean, shapes: boolean, failed: boolean): BodySide {
  const side: BodySide = { bodyCaptured: false }
  if (contentType !== undefined) side.contentType = contentType
  if (failed) return side
  if (body === undefined) return side
  if (!shapes) return side
  side.bodyShape = valueToBodyShape(body)
  return side
}

/**
 * The only permitted exit from the probe.
 *
 * It takes a raw observation, in which values are still present, and returns
 * the payload that may cross into the extension. Everything that reaches the
 * service worker passes through this function; nothing else in the probe may
 * build a payload.
 *
 * The tests for this function are property tests: they feed records containing
 * a sentinel string and assert that the string appears nowhere in the output.
 * A leak fails the build.
 */
export function toBridgePayload(record: ProbeRecord, policy: ExitPolicy): BridgePayload | null {
  switch (record.kind) {
    case 'network': {
      const ref = toUrlRef(record.urlRaw)
      if (ref === null) return null
      const base: RecordBase = { id: record.id, docId: record.docId, frameId: record.frameId, offsetMs: record.offsetMs }
      const request = toBodySide(record.requestBody, record.requestContentType, policy.requestBodies, policy.bodyShapes, false)
      const response = toBodySide(record.responseBody, record.responseContentType, policy.responseBodies, policy.bodyShapes, record.readFailed === true)
      return {
        ...base,
        kind: 'network',
        method: record.method,
        url: ref.url,
        redactedQueryKeys: ref.redactedQueryKeys,
        status: record.status,
        durationMs: record.durationMs,
        resourceType: record.resourceType,
        request,
        response,
      }
    }
    case 'console': {
      const args = policy.consoleVerbose
        ? record.args.map(serializeArg).map((s) => (s.length > SIZE_LIMIT ? s.slice(0, SIZE_LIMIT) : s))
        : []
      return {
        id: record.id,
        docId: record.docId,
        frameId: record.frameId,
        offsetMs: record.offsetMs,
        kind: 'console',
        level: record.level,
        message: record.args.map(serializeArg).join(' ').slice(0, SIZE_LIMIT),
        args,
        ...(record.stack === undefined ? {} : { stack: record.stack }),
        origin: record.origin,
      }
    }
    case 'action': {
      const element = record.element
      const isPassword = record.inputType === 'password'
      const valueCaptured = !isPassword && record.value !== undefined
      // An action URL that cannot be parsed yields no URL at all. Falling back
      // to the raw string would put an unredacted query into the capsule, which
      // is precisely the leak the parse is there to prevent.
      const redactedUrl = record.url === undefined ? undefined : toUrlRef(record.url)
      return {
        id: record.id,
        docId: record.docId,
        frameId: record.frameId,
        offsetMs: record.offsetMs,
        kind: 'action',
        type: record.type,
        selector: element?.id ? `#${element.id}` : null,
        strategy: element?.id ? 'id' : null,
        tag: element?.tagName.toLowerCase() ?? null,
        ...(record.inputType === undefined ? {} : { inputType: record.inputType }),
        valueCaptured,
        ...(valueCaptured && typeof record.value === 'string' ? { valueLength: record.value.length } : {}),
        ...(redactedUrl === null || redactedUrl === undefined ? {} : { url: formatUrl(redactedUrl) }),
        redactedQueryKeys: redactedUrl?.redactedQueryKeys ?? [],
      }
    }
    case 'storage': {
      const map = (source: Record<string, unknown>) =>
        Object.entries(source).map(([key, value]) => ({
          key,
          valueType: valueTypeOf(value),
          ...(policy.storageValues ? { value } : {}),
        }))
      return {
        id: record.id,
        docId: record.docId,
        frameId: record.frameId,
        offsetMs: record.offsetMs,
        kind: 'storage',
        localStorage: map(record.localStorage),
        sessionStorage: map(record.sessionStorage),
        cookieNames: [...record.cookieNames],
      }
    }
    default: {
      const exhaustive: never = record
      return exhaustive
    }
  }
}

function formatUrl(ref: UrlRedaction): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(ref.url.query)) query.set(key, value)
  const search = query.toString()
  return `${ref.url.origin}${ref.url.pathname}${search === '' ? '' : `?${search}`}`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @bugcapsule/extension test exit`
Expected: PASS.

If the property test fails, **do not weaken the test**. Find which field carried the value and remove it from the payload.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/core/exit.ts packages/extension/test/exit.test.ts
git commit -m "feat(extension): add the single privacy boundary with property tests"
```

---

### Task 4: Selector strategy chain

**Files:**
- Create: `packages/extension/src/core/selector.ts`
- Test: `packages/extension/test/selector.test.ts`

**Interfaces:**
- Consumes: `ElementView` (Task 3).
- Produces: `SelectorStrategy = 'testid' | 'id' | 'aria' | 'stable-attribute' | 'structural'`; `ComputedSelector = { tag: string; selector: string; strategy: SelectorStrategy }`; `computeSelector(element: ElementView): ComputedSelector`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/selector.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeSelector } from '../src/core/selector'
import type { ElementView } from '../src/core/exit'

function el(tagName: string, attrs: Record<string, string> = {}, parent: ElementView | null = null): ElementView {
  return {
    tagName,
    id: attrs.id,
    getAttribute: (name) => attrs[name] ?? null,
    parentElement: parent,
  }
}

describe('computeSelector', () => {
  it('prefers a test id over everything else', () => {
    const node = el('BUTTON', { 'data-testid': 'checkout', id: 'submit-1', 'aria-label': 'Pay' })
    expect(computeSelector(node)).toEqual({ tag: 'button', selector: '[data-testid="checkout"]', strategy: 'testid' })
  })

  it('accepts data-test and data-cy as test ids', () => {
    expect(computeSelector(el('BUTTON', { 'data-test': 'go' })).strategy).toBe('testid')
    expect(computeSelector(el('BUTTON', { 'data-cy': 'go' })).strategy).toBe('testid')
  })

  it('falls back to an id', () => {
    expect(computeSelector(el('BUTTON', { id: 'submit' }))).toEqual({
      tag: 'button',
      selector: '#submit',
      strategy: 'id',
    })
  })

  it('rejects an id that looks generated, because it will not survive a re-render', () => {
    const node = el('DIV', { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
    expect(computeSelector(node).strategy).not.toBe('id')
  })

  it('falls back to an aria label', () => {
    const node = el('BUTTON', { 'aria-label': 'Add to cart' })
    expect(computeSelector(node)).toEqual({ tag: 'button', selector: '[aria-label="Add to cart"]', strategy: 'aria' })
  })

  it('falls back to a stable attribute', () => {
    const node = el('INPUT', { name: 'email', type: 'email' })
    expect(computeSelector(node)).toEqual({ tag: 'input', selector: 'input[name="email"]', strategy: 'stable-attribute' })
  })

  it('ends with a structural path when nothing else identifies the node', () => {
    const parent = el('DIV')
    const node = el('SPAN', {}, parent)
    const result = computeSelector(node)
    expect(result.strategy).toBe('structural')
    expect(result.selector).toContain('span')
  })

  it('reports the tag in lowercase so a selector can be produced from it directly', () => {
    expect(computeSelector(el('DIV')).tag).toBe('div')
  })

  it('produces a selector that is never empty, so a consumer can always use it', () => {
    expect(computeSelector(el('DIV', {}, el('BODY'))).selector).not.toBe('')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bugcapsule/extension test selector`
Expected: FAIL — `../src/core/selector` does not exist.

- [ ] **Step 3: Implement the chain**

`packages/extension/src/core/selector.ts`:

```ts
import type { ElementView } from './exit'

export type SelectorStrategy = 'testid' | 'id' | 'aria' | 'stable-attribute' | 'structural'

export interface ComputedSelector {
  tag: string
  selector: string
  strategy: SelectorStrategy
}

const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy'] as const
const STABLE_ATTRIBUTES = ['name', 'type', 'href', 'title', 'alt'] as const

/** An id that looks machine-generated will not survive a re-render. */
const GENERATED_ID = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{16,}$/i,
  /^[a-z]*\d{6,}$/i,
  /^:r[0-9a-z]+:$/i,
  /^radix-/i,
  /^headlessui-/i,
  /^mui-\d+/i,
]

function looksGenerated(id: string): boolean {
  return GENERATED_ID.some((pattern) => pattern.test(id))
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * A selector, plus the strategy that produced it.
 *
 * The strategy is recorded rather than hidden because a `structural` selector
 * is a guess that will break on the next redesign, and a consumer deciding how
 * much to trust a reproduction deserves to know which kind it has.
 */
export function computeSelector(element: ElementView): ComputedSelector {
  const tag = element.tagName.toLowerCase()

  for (const attribute of TEST_ID_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (value !== null && value !== '') {
      return { tag, selector: `[${attribute}="${escapeAttributeValue(value)}"]`, strategy: 'testid' }
    }
  }

  const id = element.getAttribute('id') ?? element.id ?? ''
  if (id !== '' && !looksGenerated(id)) {
    return { tag, selector: `#${id}`, strategy: 'id' }
  }

  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel !== null && ariaLabel !== '') {
    return { tag, selector: `[aria-label="${escapeAttributeValue(ariaLabel)}"]`, strategy: 'aria' }
  }

  for (const attribute of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (value !== null && value !== '') {
      return { tag, selector: `${tag}[${attribute}="${escapeAttributeValue(value)}"]`, strategy: 'stable-attribute' }
    }
  }

  return { tag, selector: structuralPath(element), strategy: 'structural' }
}

function structuralPath(element: ElementView): string {
  const segments: string[] = []
  let current: ElementView | null = element
  let depth = 0

  while (current !== null && depth < 4) {
    const tag = current.tagName.toLowerCase()
    if (tag === 'html' || tag === 'body') {
      segments.unshift(tag)
      break
    }
    const id = current.getAttribute('id') ?? current.id ?? ''
    if (id !== '' && !looksGenerated(id)) {
      segments.unshift(`#${id}`)
      break
    }
    segments.unshift(tag)
    current = current.parentElement
    depth++
  }

  return segments.join(' > ')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/core/selector.ts packages/extension/test/selector.test.ts
git commit -m "feat(extension): add the selector strategy chain"
```

---

### Task 5: Action records and the password invariant

**Files:**
- Create: `packages/extension/src/core/action.ts`
- Test: `packages/extension/test/action.test.ts`

**Interfaces:**
- Consumes: `toBridgePayload` (Task 3), `computeSelector` (Task 4), `ExitPolicy` (Task 3).
- Produces: `toActionEvent(record: Extract<ProbeRecord, { kind: 'action' }>, policy: ExitPolicy): ActionEvent | null`, where `ActionEvent` is `Extract<BridgePayload, { kind: 'action' }>`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/action.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toActionEvent } from '../src/core/action'
import type { ElementView, ExitPolicy, ProbeRecord } from '../src/core/exit'

const policy: ExitPolicy = {
  queryValues: true,
  requestBodies: false,
  responseBodies: false,
  bodyShapes: true,
  storageValues: false,
  consoleVerbose: false,
}

function node(attrs: Record<string, string> = {}): ElementView {
  return { tagName: attrs.tagName ?? 'INPUT', id: attrs.id, getAttribute: (n) => attrs[n] ?? null, parentElement: null }
}

type ActionRecord = Extract<ProbeRecord, { kind: 'action' }>

function action(partial: Partial<ActionRecord>): ActionRecord {
  return { id: 'a1', docId: 'd1', frameId: 0, offsetMs: 0, kind: 'action', type: 'input', element: node(), ...partial }
}

describe('the password invariant', () => {
  it('records no value and no length for a password field', () => {
    const event = toActionEvent(action({ inputType: 'password', value: 'hunter2', element: node({ type: 'password' }) }), policy)
    expect(event?.valueCaptured).toBe(false)
    expect(event).not.toHaveProperty('valueLength')
  })

  it('does not even record that something was typed', () => {
    const typed = toActionEvent(action({ inputType: 'password', value: 'hunter2' }), policy)
    const empty = toActionEvent(action({ inputType: 'password', value: undefined }), policy)
    expect(JSON.stringify(typed)).toBe(JSON.stringify(empty))
  })

  it('never puts the password in the payload', () => {
    const event = toActionEvent(action({ inputType: 'password', value: 'hunter2' }), policy)
    expect(JSON.stringify(event)).not.toContain('hunter2')
  })
})

describe('non-password inputs', () => {
  it('records that a value was captured and how long it was, never the value', () => {
    const event = toActionEvent(action({ inputType: 'email', value: 'ada@example.com' }), policy)
    expect(event?.valueCaptured).toBe(true)
    expect(event?.valueLength).toBe(16)
    expect(JSON.stringify(event)).not.toContain('ada@example.com')
  })

  it('records no capture when the field was empty', () => {
    expect(toActionEvent(action({ inputType: 'text', value: undefined }), policy)?.valueCaptured).toBe(false)
  })
})

describe('actions carry their target', () => {
  it('includes the selector and the strategy that produced it', () => {
    const event = toActionEvent(action({ type: 'click', element: node({ 'data-testid': 'pay' }) }), policy)
    expect(event).toMatchObject({ selector: '[data-testid="pay"]', strategy: 'testid', tag: 'input' })
  })

  it('survives a null element rather than throwing', () => {
    const event = toActionEvent(action({ type: 'submit', element: null }), policy)
    expect(event).toMatchObject({ selector: null, tag: null })
  })

  it('redacts a token in the recorded url', () => {
    const event = toActionEvent(action({ type: 'navigation', url: 'https://x.test/a?token=abc&tab=settings' }), policy)
    expect(event?.url).toBe('https://x.test/a?token=%3Credacted%3E&tab=settings')
  })

  it('reports which query keys it redacted, so the ledger can account for them', () => {
    const event = toActionEvent(action({ type: 'navigation', url: 'https://x.test/a?token=abc' }), policy)
    expect(event?.redactedQueryKeys).toEqual(['token'])
  })

  it('drops an unparseable url rather than keeping it unredacted', () => {
    const event = toActionEvent(action({ type: 'navigation', url: 'not a url?token=abc' }), policy)
    expect(event).not.toHaveProperty('url')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bugcapsule/extension test action`
Expected: FAIL — `../src/core/action` does not exist.

- [ ] **Step 3: Implement it**

`packages/extension/src/core/action.ts`:

```ts
import { computeSelector } from './selector'
import { toBridgePayload, type BridgePayload, type ExitPolicy, type ProbeRecord } from './exit'

export type ActionEvent = Extract<BridgePayload, { kind: 'action' }>

/**
 * An interaction, reduced to something safe to keep.
 *
 * The format offers only `valueCaptured` and `valueLength` for an input — there
 * is no value field, so no code path here can store one. A password field is
 * stricter still: `valueCaptured` is false, so a capsule cannot reveal that
 * anything was typed at all, only that the field received focus or a change.
 */
export function toActionEvent(
  record: Extract<ProbeRecord, { kind: 'action' }>,
  policy: ExitPolicy,
): ActionEvent | null {
  const payload = toBridgePayload(record, policy)
  return payload === null || payload.kind !== 'action' ? null : payload
}
```

Note for the implementer: `toActionEvent` deliberately does no transformation of its own. Every rule lives in `toBridgePayload`, so there is exactly one place where the password invariant can be wrong. If you find yourself adding logic here, move it to `exit.ts` instead.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test action`
Expected: PASS.

If the "does not even record that something was typed" test fails, the bug is in `exit.ts`, and it is the most serious bug this package can have.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/core/action.ts packages/extension/test/action.test.ts
git commit -m "feat(extension): add action records with the password invariant pinned"
```

---

### Task 6: Network records and omission reasons

**Files:**
- Create: `packages/extension/src/core/network.ts`
- Test: `packages/extension/test/network.test.ts`

**Interfaces:**
- Consumes: `toBridgePayload`, `ExitPolicy`, `ProbeRecord` (Task 3).
- Produces: `NetworkRequest` (= `Extract<BridgePayload, { kind: 'network' }>`); `toNetworkRequest(record, policy): NetworkRequest | null`; `applyOmissionReasons(request: NetworkRequest, policy: ExitPolicy): NetworkRequest`; `OMISSION_REASONS: readonly ['disabled', 'sensitive', 'unsupported', 'size-limit', 'capture-failed']`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/network.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toNetworkRequest, applyOmissionReasons } from '../src/core/network'
import type { ExitPolicy, ProbeRecord } from '../src/core/exit'

const policy: ExitPolicy = {
  queryValues: true,
  requestBodies: false,
  responseBodies: false,
  bodyShapes: true,
  storageValues: false,
  consoleVerbose: false,
}

type NetRecord = Extract<ProbeRecord, { kind: 'network' }>

function net(partial: Partial<NetRecord>): NetRecord {
  return {
    id: 'n1',
    docId: 'd1',
    frameId: 0,
    offsetMs: 0,
    kind: 'network',
    method: 'GET',
    urlRaw: 'https://x.test/api',
    status: 200,
    durationMs: 10,
    resourceType: 'fetch',
    ...partial,
  }
}

describe('toNetworkRequest', () => {
  it('carries the request identity and timing', () => {
    const result = toNetworkRequest(net({ method: 'POST', status: 500, durationMs: 1519 }), policy)
    expect(result).toMatchObject({ method: 'POST', status: 500, durationMs: 1519, resourceType: 'fetch' })
  })

  it('returns null for a URL it cannot parse', () => {
    expect(toNetworkRequest(net({ urlRaw: '::::' }), policy)).toBeNull()
  })

  it('keeps the body shape while dropping the body', () => {
    const result = toNetworkRequest(net({ responseContentType: 'application/json', responseBody: { ok: true } }), policy)
    expect(result?.response.bodyShape).toBeDefined()
    expect(result?.response).not.toHaveProperty('body')
  })
})

describe('applyOmissionReasons', () => {
  it('explains a disabled side as disabled', () => {
    const result = applyOmissionReasons(toNetworkRequest(net({ responseBody: { ok: true } }), policy)!, policy)
    expect(result.response.omissionReason).toBe('disabled')
  })

  it('explains a non-JSON body as unsupported', () => {
    const result = applyOmissionReasons(
      toNetworkRequest(net({ responseContentType: 'text/html', responseBody: '<html>' }), policy)!,
      policy,
    )
    expect(result.response.omissionReason).toBe('unsupported')
  })

  it('explains a read failure as capture-failed', () => {
    const result = applyOmissionReasons(toNetworkRequest(net({ readFailed: true }), policy)!, policy)
    expect(result.response.omissionReason).toBe('capture-failed')
  })

  it('reports sensitive when a denylisted query key was redacted', () => {
    const request = toNetworkRequest(net({ urlRaw: 'https://x.test/a?token=abc' }), policy)!
    expect(applyOmissionReasons(request, policy).request.omissionReason).toBe('sensitive')
  })

  it('uses only reasons the schema allows', () => {
    const allowed = ['disabled', 'sensitive', 'unsupported', 'size-limit', 'capture-failed']
    const cases = [
      net({ responseBody: { ok: true } }),
      net({ responseContentType: 'text/plain', responseBody: 'x' }),
      net({ readFailed: true }),
      net({ urlRaw: 'https://x.test/a?token=1' }),
    ]
    for (const input of cases) {
      const request = toNetworkRequest(input, policy)
      if (request === null) continue
      const reason = applyOmissionReasons(request, policy).response.omissionReason
      if (reason !== undefined) expect(allowed).toContain(reason)
    }
  })

  it('leaves a successfully shaped side without an omission reason', () => {
    const result = applyOmissionReasons(
      toNetworkRequest(net({ responseContentType: 'application/json', responseBody: { ok: true } }), policy)!,
      { ...policy, bodyShapes: false, responseBodies: false, requestBodies: false },
    )
    expect(result.response.omissionReason).toBe('disabled')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bugcapsule/extension test network`
Expected: FAIL — `../src/core/network` does not exist.

- [ ] **Step 3: Implement it**

`packages/extension/src/core/network.ts`:

```ts
import { toBridgePayload, type BridgePayload, type ExitPolicy, type ProbeRecord } from './exit'

export type NetworkRequest = Extract<BridgePayload, { kind: 'network' }>
export type OmissionReason = 'disabled' | 'sensitive' | 'unsupported' | 'size-limit' | 'capture-failed'

/** The five reasons `spec/0.1/network.schema.json` permits. Nothing else may be emitted. */
export const OMISSION_REASONS: readonly OmissionReason[] = [
  'disabled',
  'sensitive',
  'unsupported',
  'size-limit',
  'capture-failed',
]

export function toNetworkRequest(
  record: Extract<ProbeRecord, { kind: 'network' }>,
  policy: ExitPolicy,
): NetworkRequest | null {
  const payload = toBridgePayload(record, policy)
  return payload === null || payload.kind !== 'network' ? null : payload
}

function isJsonContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  return /^application\/(json|[^;]+\+json)/i.test(contentType.trim())
}

/**
 * Say why a side has no body, using only the reasons the schema allows.
 *
 * A consumer that finds an empty body needs to know whether the producer chose
 * not to look, looked and found something it could not represent, or tried and
 * failed. Those are three different debugging situations and collapsing them
 * into silence is how a capsule becomes misleading.
 */
export function applyOmissionReasons(request: NetworkRequest, policy: ExitPolicy): NetworkRequest {
  const annotated: NetworkRequest = { ...request, request: { ...request.request }, response: { ...request.response } }

  if (request.redactedQueryKeys.length > 0) {
    annotated.request.omissionReason = 'sensitive'
  }

  for (const side of ['request', 'response'] as const) {
    const body = annotated[side]
    if (body.omissionReason !== undefined) continue
    if (body.bodyShape !== undefined) continue
    if (side === 'request' && !policy.requestBodies) {
      body.omissionReason = 'disabled'
      continue
    }
    if (side === 'response' && !policy.responseBodies) {
      body.omissionReason = body.contentType !== undefined && !isJsonContentType(body.contentType) ? 'unsupported' : 'disabled'
      continue
    }
    if (body.contentType !== undefined && !isJsonContentType(body.contentType)) {
      body.omissionReason = 'unsupported'
      continue
    }
    if (!policy.bodyShapes) {
      body.omissionReason = 'disabled'
    }
  }

  return annotated
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/core/network.ts packages/extension/test/network.test.ts
git commit -m "feat(extension): add network records and bounded omission reasons"
```

---

### Task 7: Console records

**Files:**
- Create: `packages/extension/src/core/console.ts`
- Test: `packages/extension/test/console.test.ts`

**Interfaces:**
- Consumes: `toBridgePayload`, `ExitPolicy`, `ProbeRecord` (Task 3).
- Produces: `ConsoleEntry` (= `Extract<BridgePayload, { kind: 'console' }>`); `toConsoleEntry(record, policy): ConsoleEntry`; `classifyConsoleOrigin(stack: string | undefined, extensionOrigins: readonly string[]): 'page' | 'extension' | 'unknown'`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/console.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyConsoleOrigin, toConsoleEntry } from '../src/core/console'
import type { ExitPolicy, ProbeRecord } from '../src/core/exit'

const policy: ExitPolicy = {
  queryValues: true,
  requestBodies: false,
  responseBodies: false,
  bodyShapes: true,
  storageValues: false,
  consoleVerbose: false,
}

type ConRecord = Extract<ProbeRecord, { kind: 'console' }>

function log(partial: Partial<ConRecord>): ConRecord {
  return { id: 'c1', docId: 'd1', frameId: 0, offsetMs: 0, kind: 'console', level: 'log', args: [], origin: 'page', ...partial }
}

describe('toConsoleEntry', () => {
  it('keeps the message text', () => {
    expect(toConsoleEntry(log({ level: 'error', args: ['boom'] }), policy).message).toBe('boom')
  })

  it('joins several arguments into one readable message', () => {
    expect(toConsoleEntry(log({ args: ['a', 1, true] }), policy).message).toBe('a 1 true')
  })

  it('serializes an object argument without throwing', () => {
    expect(() => toConsoleEntry(log({ args: [{ a: 1 }] }), policy)).not.toThrow()
  })

  it('survives a circular argument', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const entry = toConsoleEntry(log({ args: [circular] }), policy)
    expect(entry.message).toContain('circular')
  })

  it('omits args by default so console noise does not bloat the capsule', () => {
    expect(toConsoleEntry(log({ args: ['x'] }), policy).args).toEqual([])
  })

  it('includes args when the policy asks for them', () => {
    expect(toConsoleEntry(log({ args: ['x'] }), { ...policy, consoleVerbose: true }).args).toEqual(['x'])
  })

  it('truncates an enormous message rather than filling the capsule', () => {
    const entry = toConsoleEntry(log({ args: ['x'.repeat(100_000)] }), policy)
    expect(entry.message.length).toBeLessThanOrEqual(65_536)
  })

  it('keeps a stack trace when one was provided', () => {
    expect(toConsoleEntry(log({ stack: 'Error: x\n  at y' }), policy).stack).toContain('at y')
  })
})

describe('classifyConsoleOrigin', () => {
  it('recognises a chrome-extension frame as extension noise', () => {
    const stack = 'Error\n  at chrome-extension://abcdefghijklmnop/content.js:1:1'
    expect(classifyConsoleOrigin(stack, [])).toBe('extension')
  })

  it('recognises a known extension origin', () => {
    expect(classifyConsoleOrigin('at https://x.test/a.js:1:1', ['https://x.test'])).toBe('extension')
  })

  it('answers unknown when there is no stack, rather than blaming the page', () => {
    expect(classifyConsoleOrigin(undefined, [])).toBe('unknown')
  })

  it('blames the page only when the stack says so', () => {
    expect(classifyConsoleOrigin('at https://app.test/main.js:1:1', [])).toBe('page')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bugcapsule/extension test console`
Expected: FAIL — `../src/core/console` does not exist.

- [ ] **Step 3: Implement it**

`packages/extension/src/core/console.ts`:

```ts
import { toBridgePayload, type BridgePayload, type ExitPolicy, type ProbeRecord } from './exit'

export type ConsoleEntry = Extract<BridgePayload, { kind: 'console' }>

/**
 * Which world a console entry came from.
 *
 * The default is `unknown`, never `page`. Junk from a browser extension is very
 * common in real bug reports and is routinely mistaken for an application
 * error; a format that guesses would manufacture exactly the false accusation
 * it exists to prevent.
 */
export function classifyConsoleOrigin(
  stack: string | undefined,
  extensionOrigins: readonly string[],
): 'page' | 'extension' | 'unknown' {
  if (stack === undefined || stack.trim() === '') return 'unknown'
  if (/chrome-extension:\/\//.test(stack)) return 'extension'
  if (extensionOrigins.some((origin) => origin !== '' && stack.includes(origin))) return 'extension'
  if (/https?:\/\//.test(stack)) return 'page'
  return 'unknown'
}

export function toConsoleEntry(
  record: Extract<ProbeRecord, { kind: 'console' }>,
  policy: ExitPolicy,
): ConsoleEntry {
  const payload = toBridgePayload(record, policy)
  if (payload === null || payload.kind !== 'console') {
    throw new Error('toBridgePayload refused a console record, which it must always accept')
  }
  return payload
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/core/console.ts packages/extension/test/console.test.ts
git commit -m "feat(extension): add console records with honest origin attribution"
```

---

### Task 8: Environment and state

**Files:**
- Create: `packages/extension/src/core/environment.ts`
- Create: `packages/extension/src/core/state.ts`
- Test: `packages/extension/test/environment.test.ts`
- Test: `packages/extension/test/state.test.ts`

**Interfaces:**
- Consumes: `ExitPolicy`, `ProbeRecord` (Task 3); `Environment`, `StateFile` from `@bugcapsule/format`.
- Produces: `RawEnvironment`; `toEnvironment(raw: RawEnvironment): Environment | null`; `pickBuild(metaBuild: string | null, namespacedBuild: string | null, globalBuild: string | null): string | undefined`; `toStateFile(record: Extract<ProbeRecord, { kind: 'storage' }>, policy: ExitPolicy): StateFile`.

- [ ] **Step 1: Write the failing test for the environment**

`packages/extension/test/environment.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pickBuild, toEnvironment } from '../src/core/environment'

describe('pickBuild', () => {
  it('prefers the global the format documents', () => {
    expect(pickBuild('meta', 'bc', 'global')).toBe('global')
  })

  it('prefers the namespaced tag over the generic one', () => {
    expect(pickBuild('meta', 'bc', null)).toBe('bc')
  })

  it('accepts the generic tag the format documents', () => {
    expect(pickBuild('meta', null, null)).toBe('meta')
  })

  it('returns undefined when nothing exposes a build, rather than inventing one', () => {
    expect(pickBuild(null, null, null)).toBeUndefined()
  })

  it('ignores an empty string', () => {
    expect(pickBuild('', '', '')).toBeUndefined()
  })
})

describe('toEnvironment', () => {
  const raw = {
    browserName: 'Chrome',
    browserVersion: '141.0.0.0',
    osName: 'Windows',
    osVersion: '11',
    viewport: { width: 1440, height: 900, devicePixelRatio: 1.5 },
    locale: 'en-US',
    timezone: 'Asia/Bangkok',
    online: true,
    visibilityState: 'visible',
    build: '2026.09.16-1',
  }

  it('maps every observation the format has a place for', () => {
    expect(toEnvironment(raw)).toEqual({
      browser: { name: 'Chrome', version: '141.0.0.0' },
      os: { name: 'Windows', version: '11' },
      viewport: { width: 1440, height: 900, devicePixelRatio: 1.5 },
      locale: 'en-US',
      timezone: 'Asia/Bangkok',
      network: { online: true },
      document: { visibilityState: 'visible' },
      build: '2026.09.16-1',
    })
  })

  it('drops optional fields it does not have instead of filling them with a guess', () => {
    const result = toEnvironment({
      browserName: 'Firefox',
      browserVersion: '1',
      osName: 'Linux',
      viewport: { width: 800, height: 600, devicePixelRatio: 1 },
    })
    expect(result).not.toHaveProperty('locale')
    expect(result).not.toHaveProperty('build')
    expect(result).not.toHaveProperty('timezone')
  })

  it('returns null when the required browser identity is missing', () => {
    expect(toEnvironment({ browserName: '', browserVersion: '', osName: 'Linux', viewport: { width: 1, height: 1, devicePixelRatio: 1 } })).toBeNull()
  })

  it('returns null for a non-positive viewport, which the schema forbids', () => {
    expect(toEnvironment({ browserName: 'Chrome', browserVersion: '1', osName: 'Linux', viewport: { width: 0, height: 600, devicePixelRatio: 1 } })).toBeNull()
  })
})
```

- [ ] **Step 2: Write the failing test for state**

`packages/extension/test/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toStateFile } from '../src/core/state'
import type { ExitPolicy, ProbeRecord } from '../src/core/exit'

const policy: ExitPolicy = {
  queryValues: true,
  requestBodies: false,
  responseBodies: false,
  bodyShapes: true,
  storageValues: false,
  consoleVerbose: false,
}

type StorageRecord = Extract<ProbeRecord, { kind: 'storage' }>

function storage(partial: Partial<StorageRecord> = {}): StorageRecord {
  return { id: 's1', docId: 'd1', frameId: 0, offsetMs: 0, kind: 'storage', localStorage: {}, sessionStorage: {}, cookieNames: [], ...partial }
}

describe('toStateFile', () => {
  it('keeps key names and value types without the values', () => {
    const file = toStateFile(storage({ localStorage: { theme: 'dark', count: 3, flag: true } }), policy)
    expect(file.localStorage).toEqual([
      { key: 'theme', valueType: 'string' },
      { key: 'count', valueType: 'number' },
      { key: 'flag', valueType: 'boolean' },
    ])
  })

  it('never puts a storage value in the payload by default', () => {
    const file = toStateFile(storage({ localStorage: { token: 'T0KEN' } }), policy)
    expect(JSON.stringify(file)).not.toContain('T0KEN')
  })

  it('includes values only when the policy asks', () => {
    const file = toStateFile(storage({ localStorage: { theme: 'dark' } }), { ...policy, storageValues: true })
    expect(file.localStorage).toEqual([{ key: 'theme', valueType: 'string', value: 'dark' }])
  })

  it('keeps cookie names and never their values', () => {
    expect(toStateFile(storage({ cookieNames: ['sid', 'csrf'] }), { ...policy, storageValues: true }).cookieNames).toEqual(['sid', 'csrf'])
  })

  it('identifies an object and an array as such, because a boolean turning into a string is the bug being hunted', () => {
    const file = toStateFile(storage({ localStorage: { obj: { a: 1 }, arr: [1], nothing: null } }), policy)
    expect(file.localStorage.map((e) => e.valueType)).toEqual(['object', 'array', 'null'])
  })

  it('returns empty arrays rather than omitting the section', () => {
    const file = toStateFile(storage(), policy)
    expect(file).toEqual({ localStorage: [], sessionStorage: [], cookieNames: [] })
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @bugcapsule/extension test environment state`
Expected: FAIL — both modules do not exist.

- [ ] **Step 4: Implement the environment**

`packages/extension/src/core/environment.ts`:

```ts
import type { Environment } from '@bugcapsule/format'

export interface RawEnvironment {
  browserName: string
  browserVersion: string
  osName: string
  osVersion?: string
  viewport: { width: number; height: number; devicePixelRatio: number }
  locale?: string
  timezone?: string
  online?: boolean
  visibilityState?: string
  build?: string
}

/**
 * Which build identifier to use.
 *
 * The format documents `window.__BUILD_ID__` and `<meta name="build">`. The
 * namespaced tag is accepted between them so that a project whose generic
 * `build` meta means something else can opt in without colliding.
 */
export function pickBuild(
  metaBuild: string | null,
  namespacedBuild: string | null,
  globalBuild: string | null,
): string | undefined {
  for (const candidate of [globalBuild, namespacedBuild, metaBuild]) {
    if (candidate !== null && candidate.trim() !== '') return candidate
  }
  return undefined
}

/**
 * Returns `null` when a required identity is missing.
 *
 * An environment that cannot say which browser it was is not worth shipping,
 * and the schema requires those fields, so the caller must drop the section and
 * declare a gap rather than write a placeholder.
 */
export function toEnvironment(raw: RawEnvironment): Environment | null {
  if (raw.browserName.trim() === '' || raw.browserVersion.trim() === '') return null
  if (raw.osName.trim() === '') return null
  const { width, height, devicePixelRatio } = raw.viewport
  if (!(width > 0) || !(height > 0) || !(devicePixelRatio > 0)) return null
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null

  const environment: Environment = {
    browser: { name: raw.browserName, version: raw.browserVersion },
    os: raw.osVersion === undefined || raw.osVersion === '' ? { name: raw.osName } : { name: raw.osName, version: raw.osVersion },
    viewport: { width, height, devicePixelRatio },
  }

  if (raw.locale !== undefined && raw.locale !== '') environment.locale = raw.locale
  if (raw.timezone !== undefined && raw.timezone !== '') environment.timezone = raw.timezone
  if (raw.online !== undefined) environment.network = { online: raw.online }
  if (raw.visibilityState !== undefined && raw.visibilityState !== '') {
    environment.document = { visibilityState: raw.visibilityState }
  }
  if (raw.build !== undefined && raw.build !== '') environment.build = raw.build

  return environment
}
```

- [ ] **Step 5: Implement state**

`packages/extension/src/core/state.ts`:

```ts
import type { StateFile } from '@bugcapsule/format'
import { toBridgePayload, type ExitPolicy, type ProbeRecord } from './exit'

/**
 * Storage as a snapshot, not a stream.
 *
 * The format settles this: `StateFileSchema` has no `offsetMs` and no `seq`,
 * unlike every event-shaped section. So there is nothing to hook and no setter
 * interception to get wrong; the snapshot is read once, at capture time.
 */
export function toStateFile(
  record: Extract<ProbeRecord, { kind: 'storage' }>,
  policy: ExitPolicy,
): StateFile {
  const payload = toBridgePayload(record, policy)
  if (payload === null || payload.kind !== 'storage') {
    throw new Error('toBridgePayload refused a storage record, which it must always accept')
  }

  const map = (entries: typeof payload.localStorage) =>
    entries.map((entry) =>
      entry.value === undefined
        ? { key: entry.key, valueCaptured: false, valueType: entry.valueType }
        : { key: entry.key, valueCaptured: true, value: entry.value, valueType: entry.valueType },
    )

  return {
    localStorage: map(payload.localStorage),
    sessionStorage: map(payload.sessionStorage),
    cookieNames: [...payload.cookieNames],
  }
}
```

The value type arrives already computed: `toBridgePayload` calls the format's
`valueTypeOf` on the raw value inside the page context, which is the only place
the value exists. This module passes the resulting string straight through, so
there is exactly one implementation of "what type is this" in the codebase, and
it is the format's.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/core/environment.ts packages/extension/src/core/state.ts \
  packages/extension/test/environment.test.ts packages/extension/test/state.test.ts
git commit -m "feat(extension): add environment and state capture"
```

---

### Task 9: Privacy file and capture gaps

**Files:**
- Create: `packages/extension/src/core/gaps.ts`
- Create: `packages/extension/src/core/privacy.ts`
- Test: `packages/extension/test/gaps.test.ts`
- Test: `packages/extension/test/privacy.test.ts`

**Interfaces:**
- Consumes: `ExitPolicy` (Task 3); `Privacy` from `@bugcapsule/format`.
- Produces: `GAP` (frozen code map); `type GapCode`; `class GapSet` with `add(code)`, `has(code)`, `toArray(): string[]`; `createExitPolicy(overrides?: Partial<ExitPolicy>): ExitPolicy`; `RedactionLedger` with `recordQueryKeys(keys)`, `recordHeaders(names)`, `recordStorageKeys(keys)`, `toPrivacy(policy, applied): Privacy`.

- [ ] **Step 1: Write the failing test for gaps**

`packages/extension/test/gaps.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GAP, GapSet } from '../src/core/gaps'

describe('GAP', () => {
  it('uses the codes the design document names', () => {
    expect(GAP.missedBeforeInject).toBe('missed-before-inject')
    expect(GAP.swRestarted).toBe('sw-restarted')
    expect(GAP.screenshotUnavailable).toBe('screenshot-unavailable')
    expect(GAP.workersNotCaptured).toBe('workers-not-captured')
    expect(GAP.crossOriginFramesNotCaptured).toBe('cross-origin-frames-not-captured')
  })
})

describe('GapSet', () => {
  it('records a code once however often it is added', () => {
    const gaps = new GapSet()
    gaps.add(GAP.swRestarted)
    gaps.add(GAP.swRestarted)
    expect(gaps.toArray()).toEqual(['sw-restarted'])
  })

  it('reports membership', () => {
    const gaps = new GapSet()
    gaps.add(GAP.workersNotCaptured)
    expect(gaps.has(GAP.workersNotCaptured)).toBe(true)
    expect(gaps.has(GAP.swRestarted)).toBe(false)
  })

  it('produces a sorted array so two runs with the same gaps compare equal', () => {
    const gaps = new GapSet()
    gaps.add(GAP.swRestarted)
    gaps.add(GAP.missedBeforeInject)
    expect(gaps.toArray()).toEqual(['missed-before-inject', 'sw-restarted'])
  })
})
```

- [ ] **Step 2: Write the failing test for privacy**

`packages/extension/test/privacy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createExitPolicy, RedactionLedger } from '../src/core/privacy'
import { validateCapsule } from '@bugcapsule/format'

describe('createExitPolicy', () => {
  it('captures shape but no values by default', () => {
    expect(createExitPolicy()).toEqual({
      queryValues: true,
      requestBodies: false,
      responseBodies: false,
      bodyShapes: true,
      storageValues: false,
      consoleVerbose: false,
    })
  })

  it('accepts an override without losing the rest of the defaults', () => {
    expect(createExitPolicy({ consoleVerbose: true })).toEqual({
      queryValues: true,
      requestBodies: false,
      responseBodies: false,
      bodyShapes: true,
      storageValues: false,
      consoleVerbose: true,
    })
  })
})

describe('RedactionLedger', () => {
  it('counts hits per rule and lists the keys it removed', () => {
    const ledger = new RedactionLedger()
    ledger.recordQueryKeys(['token', 'session'])
    const privacy = ledger.toPrivacy(createExitPolicy(), true)
    expect(privacy.redaction.applied).toBe(true)
    expect(privacy.redaction.removedFields.queryKeys.sort()).toEqual(['session', 'token'])
  })

  it('counts one rule hit per redacted key, so the numbers add up', () => {
    const ledger = new RedactionLedger()
    ledger.recordQueryKeys(['token', 'token', 'session'])
    const byRule = ledger.toPrivacy(createExitPolicy(), true).redaction.byRule
    const total = byRule.reduce((sum, entry) => sum + entry.count, 0)
    expect(total).toBe(3)
  })

  it('reports applied=false when nothing was redacted', () => {
    expect(new RedactionLedger().toPrivacy(createExitPolicy(), false).redaction.applied).toBe(false)
  })

  it('lists header names without values', () => {
    const ledger = new RedactionLedger()
    ledger.recordHeaders(['authorization', 'cookie'])
    const privacy = ledger.toPrivacy(createExitPolicy(), true)
    expect(privacy.redaction.removedFields.headers.sort()).toEqual(['authorization', 'cookie'])
  })

  it('emits a privacy object the format accepts', () => {
    const ledger = new RedactionLedger()
    ledger.recordQueryKeys(['token'])
    const privacy = ledger.toPrivacy(createExitPolicy(), true)
    const result = validateCapsule({
      manifest: {
        format: 'bugcapsule',
        formatVersion: '0.1.0',
        id: 'x',
        createdAt: '2026-09-16T00:00:00.000Z',
        source: { name: 'test', version: '0' },
        capture: { startedAt: '2026-09-16T00:00:00.000Z', endedAt: '2026-09-16T00:00:00.000Z', durationMs: 0 },
      },
      privacy,
    })
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @bugcapsule/extension test gaps privacy`
Expected: FAIL — both modules do not exist.

- [ ] **Step 4: Implement gaps**

`packages/extension/src/core/gaps.ts`:

```ts
/**
 * Declared gaps.
 *
 * A consumer must be able to tell "there was no Web Worker on this page" apart
 * from "there was one and we did not capture it". Guessing which is which is
 * how a capsule turns into a false negative.
 */
export const GAP = {
  missedBeforeInject: 'missed-before-inject',
  swRestarted: 'sw-restarted',
  screenshotUnavailable: 'screenshot-unavailable',
  workersNotCaptured: 'workers-not-captured',
  crossOriginFramesNotCaptured: 'cross-origin-frames-not-captured',
  unparseableUrl: 'unparseable-url',
  environmentUnavailable: 'environment-unavailable',
} as const

export type GapCode = (typeof GAP)[keyof typeof GAP]

export class GapSet {
  private readonly codes = new Set<GapCode>()

  add(code: GapCode): void {
    this.codes.add(code)
  }

  has(code: GapCode): boolean {
    return this.codes.has(code)
  }

  toArray(): string[] {
    return [...this.codes].sort()
  }
}
```

- [ ] **Step 5: Implement privacy**

`packages/extension/src/core/privacy.ts`:

```ts
import type { Privacy } from '@bugcapsule/format'
import type { ExitPolicy } from './exit'

/**
 * The extension's default posture.
 *
 * Shape yes, values no, and the three booleans that would store a value are
 * false. `queryValues` is true on purpose: a URL with every value redacted
 * cannot answer which tab was open, and a key denylist already covers the
 * parameters that matter.
 */
export function createExitPolicy(overrides: Partial<ExitPolicy> = {}): ExitPolicy {
  return {
    queryValues: true,
    requestBodies: false,
    responseBodies: false,
    bodyShapes: true,
    storageValues: false,
    consoleVerbose: false,
    ...overrides,
  }
}

/**
 * A record of what was actually removed, not a description of the settings.
 *
 * `privacy.json` is a claim a consumer can check, so it must describe this
 * capture rather than the producer's intentions.
 */
export class RedactionLedger {
  private readonly queryKeys = new Map<string, number>()
  private readonly headers = new Set<string>()
  private readonly storageKeys = new Set<string>()
  private readonly bodyPaths = new Set<string>()

  recordQueryKeys(keys: readonly string[]): void {
    for (const key of keys) this.queryKeys.set(key, (this.queryKeys.get(key) ?? 0) + 1)
  }

  recordHeaders(names: readonly string[]): void {
    for (const name of names) this.headers.add(name)
  }

  recordStorageKeys(keys: readonly string[]): void {
    for (const key of keys) this.storageKeys.add(key)
  }

  recordBodyPaths(paths: readonly string[]): void {
    for (const path of paths) this.bodyPaths.add(path)
  }

  get hitCount(): number {
    let total = 0
    for (const count of this.queryKeys.values()) total += count
    return total
  }

  toPrivacy(policy: ExitPolicy, applied: boolean): Privacy {
    const byRule = [...this.queryKeys.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rule, count]) => ({ rule: `query-key:${rule}`, count }))

    return {
      policy: { ...policy },
      redaction: {
        applied,
        byRule,
        removedFields: {
          headers: [...this.headers].sort(),
          queryKeys: [...this.queryKeys.keys()].sort(),
          bodyPaths: [...this.bodyPaths].sort(),
          storageKeys: [...this.storageKeys].sort(),
        },
      },
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test`
Expected: PASS. The `validateCapsule` test in `privacy.test.ts` is the one that proves this module emits something the format actually accepts; if that fails, the bug is here and not in `@bugcapsule/format`.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/core/gaps.ts packages/extension/src/core/privacy.ts \
  packages/extension/test/gaps.test.ts packages/extension/test/privacy.test.ts
git commit -m "feat(extension): add the redaction ledger and declared capture gaps"
```

---

### Task 10: Archive assembly and the round trip

**Files:**
- Create: `packages/extension/src/core/archive.ts`
- Create: `packages/extension/src/core/index.ts`
- Test: `packages/extension/test/archive.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9; `CapsuleArchive`, `writeCapsule`, `readCapsule`, `validateCapsule`, `Manifest` from `@bugcapsule/format`.
- Produces: `AssembleInput`; `assembleCapsule(input: AssembleInput): CapsuleArchive`; `writeCapsuleFile(input: AssembleInput): Uint8Array`.

- [ ] **Step 1: Write the failing test**

`packages/extension/test/archive.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readCapsule, validateCapsule, CapsuleWriteError } from '@bugcapsule/format'
import { assembleCapsule, writeCapsuleFile, type AssembleInput } from '../src/core/archive'
import { createExitPolicy, RedactionLedger } from '../src/core/privacy'
import { GapSet, GAP } from '../src/core/gaps'

function input(partial: Partial<AssembleInput> = {}): AssembleInput {
  return {
    source: { name: 'bugcapsule-extension', version: '0.0.0' },
    id: 'cap-1',
    createdAt: '2026-09-16T10:00:00.000Z',
    role: 'broken',
    pageUrl: 'https://shop.example.com/checkout?token=abc&tab=settings',
    capture: {
      startedAt: '2026-09-16T09:59:30.000Z',
      endedAt: '2026-09-16T10:00:00.000Z',
      durationMs: 30_000,
    },
    policy: createExitPolicy(),
    ledger: new RedactionLedger(),
    gaps: new GapSet(),
    environment: {
      browser: { name: 'Chrome', version: '141' },
      os: { name: 'Windows' },
      viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
    },
    network: [],
    console: [],
    actions: [],
    state: { localStorage: [], sessionStorage: [], cookieNames: [] },
    ...partial,
  }
}

describe('assembleCapsule', () => {
  it('produces a manifest with the format identity', () => {
    const archive = assembleCapsule(input())
    expect(archive.manifest.format).toBe('bugcapsule')
    expect(archive.manifest.formatVersion).toBe('0.1.0')
    expect(archive.manifest.role).toBe('broken')
  })

  it('redacts the page URL query', () => {
    expect(JSON.stringify(assembleCapsule(input()))).not.toContain('abc')
  })

  it('always includes privacy, because the claim must travel with the artifact', () => {
    expect(assembleCapsule(input()).privacy).toBeDefined()
  })

  it('lists a capture gap only when one was recorded', () => {
    expect(assembleCapsule(input()).manifest.captureGaps).toBeUndefined()
    const gaps = new GapSet()
    gaps.add(GAP.swRestarted)
    expect(assembleCapsule(input({ gaps })).manifest.captureGaps).toEqual(['sw-restarted'])
  })

  it('omits a section that has no content rather than writing an empty file', () => {
    const archive = assembleCapsule(input({ environment: undefined }))
    expect(archive.environment).toBeUndefined()
  })
})

describe('the round trip', () => {
  it('writes bytes that readCapsule can open', () => {
    const bytes = writeCapsuleFile(input())
    const read = readCapsule(bytes)
    expect(read.ok).toBe(true)
    expect(read.value?.manifest.id).toBe('cap-1')
  })

  it('writes bytes that validateCapsule accepts', () => {
    const bytes = writeCapsuleFile(input())
    const read = readCapsule(bytes)
    expect(read.ok).toBe(true)
    const validated = validateCapsule({
      manifest: read.value!.manifest,
      environment: read.value!.environment,
      network: read.value!.network,
      console: read.value!.console,
      state: read.value!.state,
      actions: read.value!.actions,
      privacy: read.value!.privacy,
    })
    expect(validated.issues).toEqual([])
    expect(validated.ok).toBe(true)
  })

  it('keeps bodyShape and drops the body through the whole pipeline', () => {
    const bytes = writeCapsuleFile(
      input({
        network: [
          {
            id: 'n1',
            docId: 'd1',
            frameId: 0,
            offsetMs: 5,
            kind: 'network',
            method: 'GET',
            url: { origin: 'https://x.test', pathname: '/api', query: {} },
            redactedQueryKeys: [],
            status: 200,
            durationMs: 7,
            resourceType: 'fetch',
            request: { bodyCaptured: false },
            response: { contentType: 'application/json', bodyCaptured: false, bodyShape: { type: 'object', properties: { ok: { type: 'boolean' } } } },
          },
        ],
      }),
    )
    const text = Buffer.from(bytes).toString('latin1')
    expect(text).toContain('bodyShape')
    expect(text).not.toContain('"body":')
  })

  it('refuses to write an archive the format rejects', () => {
    expect(() => writeCapsuleFile(input({ id: '' }))).toThrow(CapsuleWriteError)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bugcapsule/extension test archive`
Expected: FAIL — `../src/core/archive` does not exist.

- [ ] **Step 3: Implement assembly**

`packages/extension/src/core/archive.ts`:

```ts
import {
  writeCapsule,
  type ActionsFile,
  type CapsuleArchive,
  type ConsoleFile,
  type Environment,
  type Manifest,
  type NetworkFile,
  type Privacy,
  type Source,
  type StateFile,
  type UrlRef,
} from '@bugcapsule/format'
import type { ExitPolicy } from './exit'
import type { GapSet } from './gaps'
import type { RedactionLedger } from './privacy'
import { toUrlRef } from './url'

export interface AssembleInput {
  source: Source
  id: string
  createdAt: string
  role: 'working' | 'broken' | 'unknown'
  pageUrl: string
  capture: { startedAt: string; endedAt: string; durationMs: number }
  policy: ExitPolicy
  ledger: RedactionLedger
  gaps: GapSet
  environment?: Environment
  network: NetworkFile['requests']
  console: ConsoleFile['entries']
  actions: ActionsFile['events']
  state: StateFile
  screenshot?: Uint8Array
}

/**
 * Everything the capture produced, in the shape the writer expects.
 *
 * A section with no content is omitted rather than written empty: the manifest
 * records which entries exist, so an absent section and an empty one are
 * different statements, and the writer needs the manifest to be true.
 */
export function assembleCapsule(input: AssembleInput): CapsuleArchive {
  const page: UrlRedactionResult = toUrlRef(input.pageUrl)
  if (page !== null) input.ledger.recordQueryKeys(page.redactedQueryKeys)

  // Every redaction that actually happened is accounted for, wherever it
  // happened: the page URL, the requests, and the recorded action URLs. A
  // ledger that counted only one of those would understate the redactions in
  // `privacy.json`, and understating them is the one direction of error that
  // turns a checkable claim into a misleading one.
  for (const request of input.network) input.ledger.recordQueryKeys(request.redactedQueryKeys)
  for (const event of input.actions) input.ledger.recordQueryKeys(event.redactedQueryKeys)

  const applied = input.ledger.hitCount > 0
  const privacy: Privacy = input.ledger.toPrivacy(input.policy, applied)

  const manifest: Manifest = {
    format: 'bugcapsule',
    formatVersion: '0.1.0',
    id: input.id,
    createdAt: input.createdAt,
    source: input.source,
    capture: input.capture,
    role: input.role,
  }
  if (page !== null) manifest.page = page.url

  const gapList = input.gaps.toArray()
  if (gapList.length > 0) manifest.captureGaps = gapList

  const archive: CapsuleArchive = { manifest, privacy }

  if (input.environment !== undefined) archive.environment = input.environment
  if (input.actions.length > 0) archive.actions = { events: input.actions }
  if (input.network.length > 0) archive.network = { requests: input.network }
  if (input.console.length > 0) archive.console = { entries: input.console }
  archive.state = input.state
  if (input.screenshot !== undefined) archive.screenshot = input.screenshot

  return archive
}

type UrlRedactionResult = { url: UrlRef; redactedQueryKeys: string[] } | null

/**
 * Assemble and serialize.
 *
 * `writeCapsule` is strict, and letting it throw here is the point: a capture
 * that produced something malformed must fail in front of the person who can
 * re-run it, rather than produce a file that a reader later cannot trust.
 */
export function writeCapsuleFile(input: AssembleInput): Uint8Array {
  return writeCapsule(assembleCapsule(input))
}
```

- [ ] **Step 4: Create the package entry point**

`packages/extension/src/core/index.ts`:

```ts
export * from './caps'
export * from './buffer'
export * from './redact'
export * from './url'
export * from './exit'
export * from './selector'
export * from './action'
export * from './network'
export * from './console'
export * from './environment'
export * from './state'
export * from './gaps'
export * from './privacy'
export * from './archive'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bugcapsule/extension test`
Expected: PASS, every test from Tasks 1–10.

- [ ] **Step 6: Run the whole repository suite to prove nothing regressed**

Run: `pnpm test`
Expected: PASS — the existing 105 tests plus the new ones. If an existing test fails, this package broke something shared; fix it before continuing.

- [ ] **Step 7: Typecheck and check schemas**

Run: `pnpm typecheck && pnpm check:schemas`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/extension/src/core/archive.ts packages/extension/src/core/index.ts \
  packages/extension/test/archive.test.ts
git commit -m "feat(extension): assemble valid capsules from synthetic capture records"
```

---

## Self-Review

Run against the spec after the plan is written. Fix inline; do not re-review.

**1. Spec coverage.** Mapping each spec section to the task that implements it:

| Spec section | Task |
|---|---|
| §4 architecture (pure core) | Tasks 1–10 (all of `src/core`); the four runtime contexts are Plan 2 |
| §5 privacy boundary | **Task 3** (the property tests), §5's bridge-to-worker split in Task 8 |
| §6.3 service worker owns buffers | Task 1 (`EventRing`); the worker itself is Plan 2 |
| §7 environment | Task 8 |
| §7 actions, selector chain, password invariant | Tasks 4, 5 |
| §7 network, `bodyShape`, `omissionReason` | Tasks 3, 6 |
| §7 console, `source` | Task 7 |
| §7 state | Task 8 |
| §7 privacy, `removedFields` | Task 9 |
| §7 manifest, `captureGaps`, `files` | Task 10 |
| §7 screenshot | Plan 2 (needs `chrome.tabs.captureVisibleTab`) |
| §8 ring buffer semantics and caps | Task 1 |
| §10 error handling and degradation | Tasks 6 (`omissionReason`), 9 (`GapSet`), 10 (refuse to write) |
| §11 policy clarification | Task 9 (`createExitPolicy` defaults), plus the spec prose edit, which is its own commit |
| §12 unit tests | Every task |
| §12 e2e | **Plan 2** — cannot exist without a browser |
| §13 build | Plan 2 |

Gaps found and closed: the spec's §11 prose edit is **not** implemented by any task above. It is a documentation change to `spec/bugcap-v0.1.md`, and it belongs to Plan 2 along with the e2e test that asserts the pair, because the claim and its check should land together.

**2. Placeholder scan.** No `TBD`, no `TODO`, no "add error handling", no "similar to Task N", no step that describes work without showing it. Every code step carries the code it needs.

**3. Type consistency.** Signatures were checked across tasks:

- `EventRing.push(kind, payload, offsetMs)` — Task 1, used in Tasks 1 only. Consistent.
- `toBridgePayload(record, policy): BridgePayload | null` — defined Task 3, called by Tasks 5, 6, 7, 8. Every caller narrows on `payload.kind` before use.
- `ElementView` — defined Task 3, imported by Task 4 and used in Task 5's tests.
- `SelectorStrategy` — Task 4 defines it with five members matching `spec/0.1/actions.schema.json` exactly.
- `ActionEvent`, `NetworkRequest`, `ConsoleEntry` are all `Extract<BridgePayload, { kind: ... }>`, so the bridge payload is the single definition of every event shape. This is deliberate: adding a field in one place cannot desynchronize the others.
- `RedactionLedger.toPrivacy(policy, applied)` — Task 9 defines it, Task 10 calls it.
- `AssembleInput.ledger` is a `RedactionLedger` **instance**; Task 10 mutates it with `recordQueryKeys`, which is why `toPrivacy` is called after that line. Order matters and is shown.

Four defects were found by this review and fixed inline, rather than left for the implementer to trip over:

- Task 1's `evict` carried a dead `cap` variable and an unnecessary `Number()` cast around a value that was already a number. Both are gone, and the `KIND_CAP` indirection with them: `'network' | 'console' | 'action'` are already keys of `BufferCaps`.
- Task 3's `exit.ts` defined a private `valueTypeOf` duplicating the format's, and typed its result as `string` rather than the format's vocabulary. It now imports the format's function and derives `StorageValueType` from it, so the repository has exactly one implementation of "what type is this".
- Task 8's `toStateFile` passed a type *string* into a function that takes a *value*. It now passes the already-typed value through untouched.
- Task 10's `assembleCapsule` computed `applied` as `hitCount > 0 || page?.redactedQueryKeys.length !== 0`, which evaluates to `true` whenever `page` is `null`, because `undefined !== 0`. It also recorded redacted query keys from the page URL alone, silently omitting the keys redacted inside request URLs and action URLs — an understated `privacy.json`, which is the one direction of error that matters. Both fixed: every payload's `redactedQueryKeys` is recorded before the ledger is serialized, and `applied` is simply `hitCount > 0`.

## Execution Handoff

Plan 1 is complete and saved. Two execution options:

**1. Subagent-driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline execution** — execute the tasks in this session with checkpoints for review.

Plans 2 (browser wiring + e2e) and 3 (popup + permissions) follow after Plan 1 is green.
