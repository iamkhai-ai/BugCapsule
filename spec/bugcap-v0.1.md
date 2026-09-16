# BugCapsule Format Specification v0.1

- **Status:** Frozen for v0.1
- **`formatVersion`:** `0.1.0`
- **Date:** 2026-09-16

> **The most important rule of this document: the format is permanent.**
> A capsule that has been captured cannot be given additional fields. Everything
> needed to read, diff and investigate it in the years to come must be present in
> v0.1 **right now**, even if the algorithm that uses it only appears in a later
> version. This is why v0.1 carries `docId`, `frameId`, `seq`, `role` and `bodyShape`.

The keywords **MUST**, **MUST NOT**, **SHOULD**, **MAY** are understood per RFC 2119.

---

## 0. Source of truth

The JSON Schemas in `spec/0.1/*.schema.json` are **generated automatically** from
`packages/format/src/*.ts` (zod 4). To change a schema, change the zod definition
and then run `pnpm gen:schemas`; a drift test exists, so a manual edit turns the
test red.

Consequence: the TypeScript types, the validator and the contract published to
third parties cannot diverge, because all three read from one definition.

One deliberate exception: **the published JSON Schema relaxes
`additionalProperties` to `true`**. `z.object()` emits `false` by default, but §12
requires the reader to ignore unrecognized fields — without the relaxation the
contract itself would break forward compatibility. Strict checking is the
**producer**'s obligation, not the contract's.

---

## 1. Goals and non-goals

**In v0.1:** one artifact to hand over when there is a frontend bug — no server,
no account, no tracking; self-contained; openable offline; and **diffable** between
a working run and a broken run.

**Outside v0.1** (not to be added to the format at v0.1): video, DOM replay, AI,
cloud/backend, Jira/Linear integration, mandatory HTTP response bodies, path
template normalization.

---

## 2. Packaging unit

A `.bugcap` is a **ZIP** file. Entry names are part of the format and MUST NOT
change within the same MAJOR:

| Entry | Contents |
|---|---|
| `manifest.json` | Required |
| `environment.json` | Optional |
| `actions.json` | Optional |
| `network.json` | Optional |
| `console.json` | Optional |
| `state.json` | Optional |
| `privacy.json` | Optional |
| `assets/screenshot.png` | Optional |

JSON SHOULD be deflated. `assets/screenshot.png` SHOULD be **stored** (not
compressed) because PNG is already compressed — compressing it again only makes
the file larger.

`manifest.files` maps logical names to entry paths. Reader MUST NOT trust
`files`; it MUST read the entries that are actually present.

---

## 3. Base types

- **Timestamp:** ISO 8601 UTC, MUST end with `Z`. No local offset is stored.
- **`formatVersion`:** full semver `MAJOR.MINOR.PATCH`.
- **`UrlRef`:** `{ origin, pathname, query }`, where `query` is
  `Record<string, string>`.
  - Values of keys that are **not** sensitive MUST be kept (`?tab=settings` is a
    valuable diff signal).
  - Values of sensitive keys MUST be replaced with `"<redacted>"`.
  - `?tab=settings` and `?token=SECRET` MUST NOT be treated the same: dropping all
    values to protect a few loses most of the signal.
- **`EventBase`** — every event in a capsule MUST have:
  - `id` — identifier within the capsule.
  - `docId` — the document containing the event. **Required**, because after a hard
    navigation `performance.now()` resets and the `offsetMs` of the old and the new
    document cannot be told apart without it.
  - `frameId` — `0` is the top frame. **Required**, otherwise there is no way to
    know which iframe a console error came from.
  - `offsetMs` — milliseconds since `manifest.capture.startedAt`.
  - `seq` — a monotonically increasing number, breaking ties when `offsetMs`
    collides.

---

## 4. `manifest.json`

Required: `format` (`"bugcapsule"`), `formatVersion`, `id`, `createdAt`,
`source`, `capture`.

Optional:
- `role`: `"working" | "broken" | "unknown"`. A missing value MUST be read as
  `"unknown"`. This field exists because compare mode needs to know which capsule
  is which — without it the two Working/Broken columns cannot be built.
- `page`: `UrlRef` of the page.
- `files`: map of entries.
- `captureGaps`: array of short codes declaring the **known gaps** of the capture
  session (`"workers-not-captured"`, `"missed-before-inject"`,
  `"sw-restarted"`, ...). Declared honestly so that consumers do not go hunting
  for data that does not exist.

`capture`: `{ startedAt, endedAt, durationMs }`.

---

## 5. `privacy.json`

```
policy:  queryValues requestBodies responseBodies bodyShapes storageValues consoleVerbose
redaction: { applied, byRule[], removedFields{headers,queryKeys,bodyPaths,storageKeys} }
```

**`privacy.json` is a verified claim, not a promise.**
If `policy` says a category of data is not captured while that data is still
present in the capsule, the capsule is **invalid** (`privacy-claim-violated`).
A producer cannot declare one thing and do another.

`removedFields` records the **names** of removed fields, **never the value**.
Header names and query key names are not secrets, and "was the `authorization`
header sent" is a real debugging question. Counting occurrences without naming
them is not enough.

`policy` MUST declare every field; there is no implicit default. If
`requestBodies` is `false`, a consumer MUST understand that the body **was never
read**, which is entirely different from "read and then deleted".

---

## 6. `environment.json`

`browser`, `os`, `viewport`, `locale`, `timezone`, `network.online`,
`document.visibilityState`, `build`.

Deliberately **no** device fingerprinting: no GPU, no font list, no hardware ID,
no IP. Those things are not needed to reproduce the bug and turn the capsule into
an identifying trace.

`build` is very cheap and answers the question "which deploy is this bug in".

---

## 7. `actions.json`

Each event: `type` (`click | input | change | submit | navigation | keydown`),
`target` (`tag`, `selector`, `strategy`, `role?`, `inputType?`), `url?`
(navigation), `metadata` (`valueCaptured`, `valueLength?`).

`strategy` in decreasing order of trust: `testid`, `id`, `aria`,
`stable-attribute`, `structural`. `structural` depends on layout and SHOULD be
displayed with low confidence.

**Invariant:** if `target.inputType === "password"` then
`metadata.valueCaptured` MUST be `false`. There is no override.

---

## 8. `network.json`

Only `fetch` and `xhr`. `chrome.webRequest` cannot read response bodies, so
monkey-patching is the only source — which is why the format uses `network.json`
and **never** `.har`.

Each request: `method`, `url` (`UrlRef`), `resourceType`, `status`,
`durationMs`, `request`, `response`. Each side is a `CapturedBody`:

- `contentType?`
- `bodyCaptured` — required, must not be left ambiguous.
- `body?` — `{ type: "json"|"text", value }`.
- `bodyShape?` — type tree, **captured by default** (§11).
- `omissionReason?` — `disabled | sensitive | unsupported | size-limit |
  capture-failed`. `disabled` means it was never read.

**Invariant:** if `bodyCaptured === false` then `body` MUST NOT be present.

---

## 9. `console.json`

Each entry: `level` (`error | warn | info | debug | log`), `message`, `stack?`,
`args?` (array of **strings** serialized by the producer with depth-limit,
size-limit, cycle-safe handling and redaction), `source` (`page | extension |
unknown`).

`source` exists to filter noise from other extensions — junk is very common in
real bug reports and is often mistaken for a bug in the app.

---

## 10. `state.json`

- `localStorage`, `sessionStorage`: array of `{ key, valueCaptured, value?,
  valueType? }`.
- `cookieNames`: array of cookie **names**.

Cookie values MUST NOT be stored, and `Set-Cookie` is in the hard-deny list.
But cookie **names** are kept, because the most common auth bug is "the session
cookie was not set" — that is a change in *key presence*, not in value. Dropping
cookie names while keeping localStorage keys is inconsistent.

`valueType` is **only the type**, not the value — the same principle as
`bodyShape`, it allows detecting `boolean → string` without reading the value.

---

## 11. `bodyShape` — the shape language

```
shape := { "type": "object", "properties": { <key>: shape } }
       | { "type": "array", "items": shape }
       | { "type": "string" | "number" | "boolean" | "null" | "unknown" }
       | { "anyOf": [ shape, ... ] }        // at least 1 element
```

A shape is inferred **in the page context**. Only the shape crosses the bridge;
a value never leaves the page context.

**Why it is on by default.** Most valuable diff signals — `type-change`,
`nullability-change`, `presence-change`, `schema-shape-change` — can be derived
from *structure*, with no need for values. Having `bodyShape` on by default means
diffing works under default privacy, and it is **stronger** privacy than opt-in
body capture because the value goes nowhere.

Rules for merging several shapes into one:

- Object: **merge keys** (union of the keys, recursing into each key), MUST NOT
  collapse into `anyOf` — an array whose elements each lack a different key is
  normal, and turning it into a union would produce a false
  `schema-shape-change`.
- Array: merge `items`.
- Everything else: deduplicate by canonical key and then sort; more than one
  becomes `anyOf`.

The v0.1 scope is only a minimal type tree. Optionality, format, unions learned
from samples, and numeric constraints are **advanced inference**, outside v0.1.

---

## 12. Compatibility contract

This is a testable contract, not "best effort":

| Case | Reader behavior |
|---|---|
| Different `MAJOR` | **Reject** with a reason. Reader MUST NOT guess backwards. |
| Same `MAJOR`, higher `MINOR` | **Readable**, with a warning. Unrecognized fields MUST be ignored. |
| Same `MAJOR`, lower or equal `MINOR` | Normal read. |
| `PATCH` | Ignored. |
| Malformed version | Reject with a reason; MUST NOT throw out of the API. |

`MINOR` is only allowed to **add optional fields**. It MUST NOT change the
meaning of an existing field. Only `MAJOR` is allowed to make breaking changes.

Reader MUST NOT fail on an unknown field. Producer SHOULD fail on an unknown
field (strict mode) to catch typos at the moment the capsule is created.

---

## 13. Invariants that JSON Schema cannot express

The schema holds *structure*; the validator holds *invariants*. This is why the
schema does not use `refine()`: constraints of this kind would be invisible in
the published JSON Schema.

| Code | Condition |
|---|---|
| `capture-window-invalid` | `endedAt` MUST NOT be before `startedAt` |
| `body-present-but-not-captured` | `bodyCaptured === false` ⇒ no `body` |
| `password-value-captured` | `inputType === "password"` ⇒ `valueCaptured === false` |
| `privacy-claim-violated` | `policy` says not captured ⇒ that data MUST NOT be present |
| `unsupported-format-version` | `MAJOR` not supported |
| `unknown-field` | Only in producer `strict` mode |

---

## 14. Safety requirements when reading

**A capsule is untrusted input.** It arrives from someone else over chat or email.
Reader MUST:

1. Reject entries with an absolute path, starting with `\`, containing `\`, with a
   drive prefix (`C:`), containing control characters, or containing a `..`
   segment (`unsafe-entry-path`).
2. Check the **total size after decompression** from the central directory
   **before decompressing any byte** (`capsule-too-large`). This is what makes the
   zip bomb limit real rather than decorative.
3. Ignore entries that are not in the §2 list, with a warning — **not** treated as
   an error, because future MINOR versions are allowed to add files.
4. Reject bytes that do not start with the ZIP signature (`not-a-zip`).
5. **Never** write an entry to disk automatically.

---

## 15. Size limits and budgets

| Item | Limit |
|---|---|
| `.bugcap` file | 10 MB |
| Total uncompressed size | `min(200 MB, 100× compressed)` |
| Body per side | 64 KB |
| Total body in one capsule | 2 MB |
| Screenshot | 2 MB |

These limits must be consistent with one another: 100 requests × 64 KB × 2 sides
is already 12.8 MB, exceeding the file cap — so **the total body budget is the
real constraint**, not the per-body limit.

When the budget is exceeded, the producer MUST drop data in a deterministic order
(largest body first), record `omissionReason: "size-limit"`, and **MUST NOT be
silent**.

---

## 16. Diff signal classification (v0.1)

`weight`: 3 = red, 2 = amber, 1 = informational. `visibility`: `shown` or `hidden`.

| `kind` | weight | visibility | confidence |
|---|---|---|---|
| `status-class-change` | 3 | shown | high |
| `console-error-appeared` | 3 | shown | high |
| `presence-change` | 3 | shown | high |
| `type-change` | 3 | shown | high |
| `nullability-change` | 3 | shown | high |
| `schema-shape-change` | 3 | shown | high |
| `request-only-in-broken` | 3 | shown | medium |
| `request-only-in-baseline` | 3 | shown | medium |
| `state-key-added` / `state-key-removed` | 3 | shown | high |
| `state-type-changed` | 3 | shown | high |
| `environment-changed` (`build`) | 3 | shown | medium |
| `duration-outlier` | 2 | shown | low |
| `console-warn-appeared` | 2 | shown | medium |
| `console-error-disappeared` | 2 | shown | medium |
| `state-value-changed` (boolean) | 2 | shown | medium |
| `environment-changed` (other) | 1 | shown | low |
| `console-message-changed` | 1 | shown | low |
| `state-value-changed` (string/number) | 1 | **hidden** | low |
| `action-only-in-broken` / `-baseline` | 1 | shown | low |

Notable classification rules:

- `field: string` → `field: string|null` is a **`nullability-change`**, not a
  `type-change`. This is one of the most common bugs.
- `duration-outlier` only when the difference is `>= 1000ms` **and** `>= 3×`.
  Below the threshold it is counted into `dropped` with the kind
  `duration-noise`.
- A boolean `state-value-changed` is **shown**: one bit of information cannot be
  PII, so a feature flag flipping `false → true` is both private and full of
  signal. Strings and numbers are the opposite — very likely an id or a
  timestamp — so they are **hidden by default**.

### Presentation order

Sort by, in order:

1. `weight` descending
2. `proximityMs` ascending — `offsetMs` minus the **first anomaly**
   (the first console `error` or the first status `>= 400`, whichever is earlier).
   Negative means before the anomaly.
3. priority table by `kind`
4. `kind`, then `id`

Step 3 exists because otherwise the order falls back to alphabetical string
comparison and `presence-change` would stand above `status-class-change` — that
is, five consequences of one 500 error would bury the 500 itself underneath.

`proximityMs` measures to the **first anomaly**, not to the start of the capture
session: an ordinary request at second 29 does not deserve to be pushed down
merely because it happened late.

---

## 17. Trust budget

Every diff line MUST carry `confidence` and a one-line `reason`. A line that
cannot explain why it is trustworthy does not deserve to be displayed.

Never hide silently:

- What is hidden goes in `hidden` with `defaultVisibility: "hidden"`.
- What is dropped goes in `dropped` with a **count**, always present even when
  empty.
- What the user dismissed goes in `suppressed` with `suppressedCount`.

A signal's `id` MUST be stable across runs — otherwise dismissal is meaningless.

---

## 18. Known to be insufficient

Declared honestly, nothing hidden:

- **`pathTemplate` does not exist in v0.1.** The request join key is
  `method + pathname + signature of the query key set`. Consequence:
  `/products/123` and `/products/456` are two different requests. Normalizing the
  template is left to v0.2; the diff engine *can* infer the template from the
  union of the two capsules without a stored field.
- Multiple requests sharing a join key are joined **in order**; a mismatch in the
  count produces `request-only-in-*`. Joining in order is the v0.1 convention.
- Workers, WebSocket and SSE are not captured; the producer SHOULD declare them
  in `captureGaps` if they are present on the page.
- There is no Start/Stop: capture keeps a ring buffer and freezes when the user
  clicks. Caps: 500 events total / 200 network / 200 console / 100 actions / 30
  seconds.
- `chrome.debugger` is not used in v0.1.

---

## 19. Verification

Every claim above MUST have a test. Current status:

```
Test Files  10 passed (10)
     Tests  105 passed (105)
typecheck  exit 0
```

Commands:

```
pnpm test            # all tests
pnpm typecheck       # tsc --noEmit
pnpm check:schemas   # does the committed JSON Schema still match the zod source
pnpm gen:fixtures    # regenerate fixtures/*.bugcap
pnpm show:diff       # print the end-to-end diff from the committed fixture
```

The fixtures in `fixtures/` are committed binaries, generated deterministically,
and covered by a drift test: `checkout-working` (201, `{orderId,total,etaDays}`)
against `checkout-broken` (500, `{error,traceId}`). **Bodies are not captured on
either side** — the whole schema signal comes from `bodyShape`, exactly as §11
was designed.
