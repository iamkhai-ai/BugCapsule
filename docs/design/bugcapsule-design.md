# BugCapsule — Design Spec

- **Date:** 2026-09-16
- **Status:** Awaiting user review
- **Capsule format version:** `0.1`

---

## Status and reconciliation

- This document records the original design. The normative, frozen contract is now `spec/bugcap-v0.1.md`.
- The planned packages `schema`, `capsule` and `diff` were not built under those names. What exists:
  - `@bugcapsule/format` at `packages/format` — contains what this document assigned to both `schema` and `capsule`: the zod schemas, the inferred TypeScript types, the validator, the compatibility contract, and the `.bugcap` writer and reader. Zod is the single source of truth; the JSON Schema in `spec/0.1/` is generated FROM it, not the other way round.
  - `@bugcapsule/diff` at `packages/diff` — the diff engine.
  - `@bugcapsule/fixtures` at `packages/fixtures` — private, dev-only generators for the committed fixture capsules.
- There is no `redact` package. Redaction lives inside `packages/format`.
- Three fixture capsules are committed as binary files: `fixtures/minimal.bugcap`, `fixtures/checkout-working.bugcap`, `fixtures/checkout-broken.bugcap`. They are generated deterministically and an anti-drift test asserts they are byte-reproducible.

## 1. Problem

Frontend bug reports usually lack technical context. QA sends a one-line description plus a screenshot; the developer asks about the console, asks about the network request, asks about the state — and still often cannot reproduce the bug.

Existing tools (Jam, OpenReplay, OpenJam, Brie) solve the "missing data" part by **collecting more**: hundreds of network requests, dozens of console logs, session replay, metrics. A new problem appears: the developer receives a pile of data and has to answer *"in this pile, what is actually unusual?"* by themselves.

BugCapsule takes the opposite direction.

## 2. Positioning

> **BugCapsule**
> Capture a frontend bug as a portable debugging artifact.
> Compare working and broken sessions to see what changed.
>
> *Stop reproducing. Start diffing.*

Three pillars:
1. **Portable artifact** — a single self-contained `.bugcap` file, opens offline, no server, no account.
2. **Privacy by default** — capture less instead of capturing everything and then redacting. By default nothing leaves the user's machine.
3. **Working ↔ broken diff** — the question "what changed", not "what happened".

### Non-goals

Does not compete with session replay. Does not build video, DOM replay, backend, account, cloud sync, Jira integration, AI. Does not build an observability platform.

## 3. Settled decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Capture mechanism | Toolbar popup + early injection (`world:MAIN`, `document_start`). **MUST NOT** use `chrome.debugger` in v0.1. |
| D2 | Redaction philosophy | Two layers: capture-less-by-default (structural) + denylist redaction (only on the opt-in portion). There is a review screen, but it is not mandatory. |
| D3 | Permission model | `optional_host_permissions` + onboarding to choose domains. The ring buffer runs only on allowlisted domains. |
| D4 | v0.1 goal | Dogfood inside the team first. Prioritize robustness on real apps (iframes, GraphQL, SSR) over polish. |
| D5 | Owner of the capture pipeline | The service worker owns state; redacted metadata is written to `chrome.storage.session`; raw bodies live in a memory LRU. |

## 4. Architecture

### 4.1 Workspace structure

```
bugcapsule/
├── apps/
│   ├── extension/          # WXT + React popup
│   │   ├── entrypoints/
│   │   │   ├── background.ts      # SW — owner of state
│   │   │   ├── probe.main.ts      # world:MAIN, document_start — hooks
│   │   │   ├── bridge.isolated.ts # world:ISOLATED — relay + DOM access
│   │   │   └── popup/             # review UI
│   │   └── src/capture/           # capture logic — not yet a package
│   ├── viewer/             # Preact, builds to a single-file HTML
│   └── cli/                # npx bugcapsule open | diff
├── packages/
│   ├── schema/             # zod + JSON Schema + types (no internal package dependencies)
│   ├── capsule/            # redaction engine + read/write .bugcap
│   └── diff/               # normalization + signal classification
├── playground/             # deterministic app: healthy | broken
└── fixtures/               # golden capsule pairs + leaking payload corpus
```

**Five workspaces, not seven.** `packages/capture` and `packages/redaction` do not exist in v0.1: capture has no stable interface yet, so packaging it early would only create ceremony; redaction is folded into `capsule` so that it is the single door.

The goal of a "core independent of the Chrome extension" still holds — `capture` was never part of the core. Once the interface is stable (expected v0.2), `capture` is promoted to a package without any consumer having to change.

### 4.2 Dependency direction

`apps → packages`, one direction, never the reverse. `packages/schema` depends on nothing.

### 4.3 Load-bearing interface

```ts
// packages/schema — the only type that crosses the boundary
type Redacted<T> = T & { readonly __redacted: unique symbol }   // branded type

type RawSession      = { /* capture code produces this */ }
type RedactedSession = Redacted<RawSession>                     // only capsule can create it

// capture code sees only this — it knows nothing about the Chrome API
interface CaptureSink {
  push(ev: RawEvent): void
  snapshot(opts: SnapshotOpts): Promise<RawSession>
}

// the ONLY door that turns Raw -> Redacted
declare function redact(s: RawSession, cfg: RedactConfig): RedactedSession

// pure function -> trivial to test, no browser needed
declare function diffCapsules(a: Capsule, b: Capsule, cfg: DiffConfig): DiffResult
```

**Enforced at the type level:** `packages/capsule` accepts only `RedactedSession`. A future dev who adds a new capture path and forgets to redact will **fail to compile**, instead of relying on code review.

## 5. Capsule format

`.bugcap` is a zip. JSON uses deflate; the screenshot uses store (do not recompress an already-compressed image).

```
manifest.json       ← first entry in the zip
environment.json
actions.json
console.json
network.json        ← MUST NOT be named .har
state.json
screenshot.webp     ← viewport-only, already annotated
diff.baseline.json  ← present only when capturing with a baseline
report.md
viewer.html         ← self-contained, data embedded as a JSON island
```

### 5.1 `manifest.json`

```jsonc
{
  "formatVersion": "0.1",
  "generator": { "name": "bugcapsule", "version": "0.1.0" },
  "createdAt": "2026-09-16T10:22:31.402Z",
  "capsuleId": "01J8...",
  "role": "broken",                // broken | baseline | unknown
  "issue": {
    "title": "Save button doesn't work",
    "expected": "Product should be updated",
    "actual": "Nothing happens"
  },
  "route": { "url": "https://.../products/123/edit", "pathTemplate": "/products/:id/edit" },
  "baseline": { "capsuleId": "01J8...", "capturedAt": "...", "source": "local-auto" },  // or null
  "capture": { "durationMs": 30000, "events": 36, "documents": 2 },
  "redaction": {
    "total": 6,
    "hashMode": "hmac-sha256-prefix8",   // or null
    "saltId": "proj-a1b2",               // MUST NOT contain the salt
    "rules": [{ "id": "auth-header", "count": 3 }]
  },
  "fidelity": { /* required — see 5.8 */ }
}
```

Rules:
- `formatVersion` follows semver. The viewer **rejects** an unknown major and **degrades** (skips) unknown fields at a minor version.
- `role` makes it possible to diff any two capsules and is the basis of the opportunistic baseline.
- `redaction` records **rule id + count** only, never the value. Just enough for a "3 secrets removed" UI, and it does not itself create a new leak.
- `saltId` is the identifier of the salt, not the salt.

### 5.2 `network.json` — one entry

```jsonc
{
  "id": "req-42",
  "docId": "d1", "frameId": 0, "frameUrl": "https://...",
  "seq": 42, "tMono": 6012, "tWall": 1758000000000,
  "method": "GET",
  "url": "https://.../api/permissions",     // sensitive query already redacted
  "pathTemplate": "/api/permissions",
  "templateConfidence": "confirmed",         // confirmed | guessed
  "status": 403, "statusText": "Forbidden", "durationMs": 210,
  "resourceType": "fetch",                   // fetch | xhr
  "requestHeaders": { "accept": "application/json" },  // allowlist, redacted
  "requestSchema": { "type": "object", "properties": {} },
  "requestBody": null,                       // opt-in only
  "responseSchema": { "type": "object", "properties": { "error": {"type":"string"} } },
  "responseBody": null,                      // opt-in only
  "bodySkipped": { "reason": "not-opted-in", "bytes": null },
  "redactions": [{ "rule": "auth-header", "count": 1 }]
}
```

`bodySkipped.reason` ∈ `not-opted-in | size | streaming | binary | parse-error`. Every skip is recorded, never silent.

### 5.3 `console.json` — one entry

```jsonc
{
  "id": "c-7", "docId": "d1", "frameId": 0, "seq": 7, "tMono": 4210, "tWall": 1758000000000,
  "level": "error",
  "message": "Cannot read properties of undefined",
  "stack": "at PermissionService.ts:81",
  "args": null,                              // opt-in, redacted
  "source": "page",                          // page | extension | unknown
  "correlatedRequestId": "req-42",
  "correlatedDeltaMs": 12,
  "redactions": []
}
```

`source: "extension"` is used to filter noise from other extensions (`chrome-extension://`) — very common junk in real reports.

### 5.4 `actions.json` — one entry

```jsonc
{
  "id": "a-3", "docId": "d1", "frameId": 0, "seq": 3, "tMono": 2000, "tWall": 1758000000000,
  "type": "click",                           // click|input|submit|navigation|scroll|resize|visibility
  "target": {
    "selector": "button[type=submit]",
    "selectorStrategy": "testid",            // testid|id|aria|role-text|nth-path
    "tag": "button",
    "accessibleName": "Save",
    "bbox": [1204, 812, 96, 36]
  },
  "value": { "length": 12 },                 // MUST NEVER contain the value
  "url": null                                // navigation only
}
```

### 5.5 `state.json`

```jsonc
{
  "localStorage":   { "keys": ["userRole", "feature_new_product"], "values": null },
  "sessionStorage": { "keys": [], "values": null },
  "cookies":        { "count": 3, "names": ["session"] },     // no values
  "snapshot":       null    // result of window.__BUGCAPSULE_SNAPSHOT__(), redacted
}
```

`values` and `snapshot` are present only on opt-in. Redaction **still runs** over them.

### 5.6 `environment.json`

```jsonc
{
  "url": "...", "title": "...",
  "browser": { "name": "Chrome", "version": "152.0.0.0", "userAgentData": {} },
  "os": "...",
  "locale": "vi-VN", "timezones": ["Asia/Ho_Chi_Minh"],
  "viewport": { "width": 1920, "height": 1080, "dpr": 2 },
  "extension": { "version": "0.1.0" },
  "build": { "fromMeta": null, "fromWindow": null }   // <meta name="build">, window.__BUILD_ID__
}
```

`build` is worth having: "which deploy is this bug in" is a common question and a cheap one to answer if the app exposes it.

### 5.7 Timeline and multiple documents

`performance.now()` resets to 0 in each document. Each document has its own `docId`; the first event of each document anchors `tWall = Date.now()`. The viewer reconstructs the time axis by adding the offset between documents. Every event carries `{ docId, tMono, tWall, frameId, seq }`.

### 5.8 `fidelity` — required

```jsonc
{
  "probe":   { "startedAt": "document_start", "missedBeforeInject": 3 },
  "network": { "hook": "fetch+XHR", "bodiesEnabled": false, "bodiesSkipped": 4 },
  "frames":  { "injected": 2, "topFrame": true },
  "workers": "not-captured",
  "websocket": "not-captured",
  "sse": "metadata-only",
  "console": { "browserGenerated": "not-captured" },
  "swRestarted": false
}
```

Honesty is a feature. A dev who sees `workers: "not-captured"` will not go hunting ghosts in data that does not exist. No tool in the competitor group does this.

### 5.9 Format rules

- **The viewer embeds the data in itself** as `<script type="application/json" id="capsule">`. The viewer **MUST NEVER** `fetch()` sibling files: on `file://` the origin is `null` and Chrome blocks CORS → the viewer renders a blank page. This is the product's main path, not an edge case.
- The separate JSON files still ship for the CLI and outside tools (`jq`).
- The screenshot is WebP (~80% smaller than PNG), unless the user chooses PNG.
- The embedded viewer stays **< 150KB uncompressed** because it is inside *every* capsule that gets sent.
- The CLI decompressor MUST block **zip-slip** (`../`, absolute paths) and **zip-bomb**: cap the total uncompressed size at `min(200MB, 100× compressed size)`.

### 5.10 `diff.baseline.json`

```jsonc
{
  "formatVersion": "0.1",
  "a": { "capsuleId": "...", "role": "baseline", "capturedAt": "..." },
  "b": { "capsuleId": "...", "role": "broken" },
  "signals": [
    {
      "id": "net-permissions-status",
      "class": "status-class-change",
      "weight": "high",
      "target": "GET /permissions",
      "reason": "2xx → 4xx",
      "before": { "status": 200 }, "after": { "status": 403 },
      "proximityMs": 12, "confidence": "high"
    }
  ],
  "suppressed": { "value-drift": 12, "volatile": 31, "ignoredByProject": 7 }
}
```

`suppressed` is always present. **MUST NEVER hide silently.**

## 6. Capture pipeline

### 6.1 Flow

```
probe.main.ts  (world:MAIN, document_start, all_frames:true)
   │  hook: console.* · window.onerror · unhandledrejection
   │        fetch · XMLHttpRequest
   │        History API (pushState/replaceState/popstate)
   │        click/input/submit/scroll/resize (capture phase)
   │        visibilitychange
   │  every event: { docId, tMono, tWall, frameId, seq }
   ▼  postMessage + token
bridge.isolated.ts  (world:ISOLATED)
   ▼  chrome.runtime.sendMessage
background.ts  (SW — owner)
   ├─ redact()   ← THE SINGLE CHOKE POINT
   ├─ metadata  → chrome.storage.session  (batch 500ms, key cap:{tabId})
   └─ raw body  → memory LRU (1MB/response, 200 events, skip binary/streaming)
   ▼  when the user clicks Capture
capsule.write() → .bugcap → chrome.downloads
```

**Bridge handshake:** `bridge.isolated.ts` generates a random nonce per document, creates a `MessageChannel`, and sends `port2` to the MAIN world via `window.postMessage(..., location.origin)` with the marker `__BUGCAPSULE__`. `probe.main.ts` accepts only the first message matching marker + nonce, then switches to using the port. Page scripts run at `document_start` at the same moment, so a small race window exists — already recorded in §6.6.

### 6.2 Why the buffer lives in the SW

The MV3 service worker is killed when idle. A 30-second buffer held in SW memory will be lost at any moment — worst of all right when the tester comes back to click Capture.

`chrome.storage.session` survives both SW death and navigation. Because the buffer holds **only redacted metadata + JSON schema** (no bodies), 100 requests cost only a few tens of KB — well within quota. This is where the capture-less-by-default decision pays technical dividends.

Raw bodies live in SW memory with LRU + size cap. If the SW restarts, bodies are lost → `fidelity.swRestarted: true`. **MUST NOT lose data silently.**

The SW is kept warm by a light keepalive **only while capture is enabled**, not permanently.

**Buffer policy:** the capture window is the **last 30 seconds**, with simultaneous count caps: **500 events total**, **200 network**, **200 console**, **100 actions** — whichever threshold is reached first evicts FIFO along that dimension. Events older than the 30s window are dropped before the count caps are considered. These are starting numbers; tune them once real measurements from the playground exist.

### 6.3 Requirements on hooks

- Every hook wraps in `try/catch`. **MUST NEVER** throw into app code.
- Preserve `this`; keep `Function.prototype.toString` looking natural (some libraries check it).
- Handle both `fetch(Request)` and `fetch(url, init)`.
- Hook throws → fall back to the native implementation + record a `captureError` event.
- `response.clone()` **before** returning the response to the app; never consume the original.
- Skip by `content-type` when it is not JSON/text; skip if `content-length > 1MB`.
- SSE / streaming: `tee()` + timeout, do not read to completion (that hangs).

### 6.4 iframe

`all_frames: true` to inject into cross-origin frames as well. Every event carries `frameId` + `frameUrl`. The number of frames injected is recorded in `fidelity.frames`.

### 6.5 Declared out of scope

Web Workers, the app's own Service Worker, WebSocket frames, SSE bodies. Record them in `fidelity`; do not try to capture them.

### 6.6 Known security limits

The `postMessage` bridge **is not a security boundary**. A page script can in theory forge or read telemetry events in the small race window at `document_start`. Threat model: "a web page injecting junk into its own local capsule" — acceptable, **but the README MUST state it explicitly and the bridge MUST NOT be advertised as secure.**

## 7. Redaction engine

### 7.1 Layer 1 — structural (capture-less-by-default)

`RawSession` **MUST NEVER contain** these things. This is not "contain it and then delete it".

| Data | Default |
|---|---|
| URL, method, status, duration, `frameId` | ✅ |
| JSON **schema** (shape) of request/response | ✅ |
| `localStorage` / `sessionStorage` **keys** | ✅ |
| Console `error` / `warn` | ✅ |
| Console `log` / `info` / `debug` | ⚠️ opt-in |
| Request body · Response body · storage **values** | ⚠️ opt-in |
| `Authorization` · `Cookie` · `Set-Cookie` | ❌ never |
| Value of `input` / `textarea` / `contenteditable` | ❌ never (only `length`) |
| Body when > 1MB, binary, streaming | ❌ skip + record `bodySkipped` |

### 7.2 Layer 2 — redaction at the choke point

Runs in the SW, as soon as an event enters the buffer, over everything that made it in: opt-in bodies, storage values, console text, URLs.

```ts
interface RedactRule {
  id: string
  where: 'header' | 'query' | 'jsonPath' | 'formField' | 'storageValue' | 'urlPath' | 'consoleText'
  pattern: RegExp | string[]
  action: 'remove' | 'mask' | 'hash'
  optInOnly?: boolean
}
```

**Default denylist:**

- **Headers:** `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key`, `x-auth-token`, `x-csrf-token`.
- **Query:** `token`, `access_token`, `id_token`, `api_key`, `apikey`, `secret`, `password`, `pwd`, `session`, `sid`, `jwt`, `signature`, `x-amz-signature`, `x-amz-credential`, `code` (OAuth).
- **Field names** (strip `_`/`-`, lowercase): `password|passwd|pwd|secret|token|apikey|accesstoken|refreshtoken|sessionid|csrf|nonce|otp|mfa|pin|cvv|cvc|cardnumber|pan|ssn|privatekey|clientsecret|credential`. **Recurse** into nested objects and arrays — this is where GraphQL (`variables.input.password`) and multipart/form-urlencoded usually slip through.
- **Value shapes:** JWT `^eyJ...\.eyJ...\.`, `Bearer`/`Basic` prefixes, PEM `-----BEGIN ... PRIVATE KEY-----`, `AKIA[0-9A-Z]{16}`.

**Three easily forgotten leak paths:**

1. **Console text** — `console.log('Bearer abc')`, `console.log(localStorage)`, `console.log(response)`. Redaction must scan console strings, not just network.
2. **URL path** — a secret in the path (`/reset/eyJhbGci...`) is not in the query. Path segments must be scanned too.
3. **`input` value** — not just `type=password`. OTPs, card numbers and national ID numbers are all `type=text`.

### 7.3 Entropy only in context

**MUST NOT** redact by global entropy. `etag`, content hashes, SRI `integrity`, and cache keys are all high entropy; redacting them all destroys debugging value. Entropy applies **only within a secret context**: a value under a key matching the denylist, or a value inside a header.

### 7.4 Fail-closed

If the redactor throws or cannot parse a body → **drop the body**, never pass it through as-is. Fail-open here is suicide.

### 7.5 Hash mode

`Authorization: Bearer <redacted:7d4a1c93>` lets the diff detect **"the token changed between baseline and broken"** — highly relevant for auth bugs — without exposing the token.

**The salt lives in the extension config (per-project), and MUST NOT live in the capsule.** If the salt were in the capsule it would be public, and low-entropy secrets (a 4-digit PIN, a 6-digit OTP) could be brute-forced → turning into a leak after all. With the salt in config:

- The capsule holds only the hash prefix → someone with the file cannot brute-force it.
- Cross-capsule comparison still works **if two machines use the same project salt** (the team shares the salt once, out of band).
- The manifest records `hashMode` + `saltId`, not the salt.

This is an **equality-only** comparison mechanism, not "absolute safe concealment".

## 8. Diff engine

`packages/diff` is a **pure function** — this is why it is built before the extension.

```
normalize(A), normalize(B) → match → classify → rank → render
```

### 8.1 Normalization

**Segment IDs do not need to be guessed.** If **within the same capsule** we see `/api/users/2181` *and* `/api/users/7328`, then `/api/users/:id` is **confirmed** (`templateConfidence: "confirmed"`). If it appears only once, that is a **guess** (`"guessed"`) — and the report must show the original URL so the dev can verify it. Two different confidence levels, not merged.

- ID heuristic: pure numeric segment, UUID, hex ≥ 8, ULID, nanoid, long base64url.
- **Query:** sort keys; drop volatile ones (config + heuristic: a key matching `t|ts|timestamp|cache|cb|nonce|requestId|traceId|correlationId|sessionId`, or a value matching `^\d{10,13}$` (epoch seconds/ms) or a UUID); **show the number dropped**.
- **Arrays:** compare **order-insensitively by identity key** (`id`) when present, otherwise fall back to index. Without this, an array of 50 products that gets reordered produces 50 junk diffs. If only the order changed → report `ordering`, not content.
- **Volatile leaf:** `timestamp|requestId|traceId|csrf|nonce|uuid|createdAt|updatedAt|etag` — configurable per project.
- **Per-project and user-extensible ignore list.** Every codebase has its own volatile fields.

### 8.2 Matching

Key `(method, pathTemplate)`. Multiple occurrences → pair in order; a count mismatch → presence/absence signal. Body-similarity pairing is for v0.2.

### 8.3 Signal classes

| Class | Default view | Notes |
|---|---|---|
| `type-change` (`1 → "1"`) | 🔴 shown | |
| `nullability-change` (`string[] → null`) | 🔴 shown | |
| `presence-change` | 🔴 shown | |
| `schema-shape-change` | 🔴 shown | |
| `status-class-change` (`2xx → 4xx`) | 🔴 shown | |
| `request-only-in-broken` | 🔴 shown | |
| `request-only-in-baseline` | 🔴 shown | a call that should have happened did not happen |
| `ordering-change` | 🟠 shown | auth race: `GET /permissions` before `POST /login` finishes |
| `duration-outlier` | 🟠 shown | `after > 3× before` **and** `after > before + 300ms` |
| `value-drift` (same type, different value) | ⚪ **hidden** by default | `"khai" → "minh"` |
| `volatile` | ⚫ dropped entirely + counted | |

This is the part that makes the product. A naive diff that shows `username: "khai" → "minh"` on the same footing as `quantity: 1 → "1"` makes the dev scroll past and miss the important one — exactly the "127 network requests" problem BugCapsule is trying to solve.

### 8.4 Ranking

Weight desc, then by **time distance to the first anomaly** (the first console error or the first 4xx/5xx, whichever comes earlier). The closest one is the most likely cause. Deterministic, no AI.

`proximityMs` = the distance from the related event to the first anomaly; **negative** if the event happened before the anomaly.

### 8.5 Trust budget

The project's number-one risk: false positives eroding trust. Two sessions are **never** identical; diff is a heuristic and **will** be wrong. The product must tolerate that.

- Every diff line has `confidence` + **a one-sentence reason** ("same type, different value").
- Dismiss → stored per project in `chrome.storage.local`, scoped by `origin + pathTemplate`. **Not** stored in the capsule (the capsule must be portable).
- The viewer **always shows** *"7 diffs hidden by the project's ignore rules"* + an unhide button.
- Deterministic: same input → same output byte-for-byte. No timestamps in the output. Stable sort.

## 9. Baseline strategy

### 9.1 Definition

**Healthy session:** 0 console errors, 0 requests with status ≥ 400, ≥ 1 user action, duration ≥ 1000ms.

### 9.2 Storage

`chrome.storage.local`, scoped to `origin + pathTemplate`, in the form of a **reduced baseline** (no screenshot, no bodies — metadata + schema only), TTL 24h, at most 3 per origin.

**Privacy tradeoff:** an opportunistic baseline means the extension **retains redacted session data beyond the working session**, by default. It is local, redacted, has a TTL, and can be deleted — but it *is* retention. Decision: **on by default, only on allowlisted domains, with a clear toggle, and the popup shows "BugCapsule is holding 2 baselines on this machine" + a delete button.**

### 9.3 Consequences of module boundaries

A dev opens `viewer.html` from `file://` — **the viewer has no access to `chrome.storage`**. The viewer **cannot** read local baselines. Therefore:

1. **The extension computes the diff against the best baseline at capture time and embeds the result in the capsule** (`diff.baseline.json` + a section in `report.md`). The dev opens it and sees the diff immediately, and the capsule stays self-contained. **This is the main path.**
2. The viewer still supports **dragging and dropping a second capsule** → the diff is computed client-side using `packages/diff` compiled into the viewer. No server, fully offline.
3. The capsule records `baseline: { capsuleId, capturedAt, source: 'local-auto' | 'user-provided' }`.

If there is no local baseline → the viewer shows *"No baseline yet. Drag a 'working' capsule in here, or capture one yourself."*

### 9.4 App-side API: `window.__BUGCAPSULE_SNAPSHOT__`

The real state causing the bug lives in the React/Redux/Vue store, **not** in localStorage. The app declares it itself:

```js
window.__BUGCAPSULE_SNAPSHOT__ = () => ({
  cartVersion: store.cart.version,
  featureFlags: flags.active,
});
```

What it buys: deterministic, privacy-safe by design (the app author controls what is exposed), no DOM replay needed, no AI needed, and state diff becomes **real** instead of guesswork. Cost: ~30 lines in the extension + a section in the README.

## 10. Viewer

Hard constraint: **runs offline from `file://`, zero network.**

- Single HTML; data embedded as a JSON island. **Preact + `fflate` are the only two dependencies.** No Tailwind runtime, no chart lib, no component lib.
- **An imported capsule is untrusted input.** `console.message`, URLs and body strings are all controlled by the web page → XSS into the viewer is real. Mandatory: `textContent` for everything, no `innerHTML`, no `dangerouslySetInnerHTML`, CSP meta tag.
- Three modes: single capsule · diff two capsules (drag and drop) · pre-embedded diff.
- Section order: `Issue` → `Detected anomaly` (ranked) → `Environment diff` → `State diff` → `Console` (grouped + correlated) → `Network` (only anomalies expanded by default) → `Actions` + annotated screenshot → `Fidelity` + `Redaction report`.
- The screenshot has **numbered markers** per action; clicking a marker jumps to the action. An anchor `#network-ordering` in the URL hash lets a dev send a link under `file://`.
- An unhide button for diffs hidden by ignore rules.

**The blur tool does NOT live in the viewer.** If the original image is already in the file, blurring afterwards is theater — the data has already left. Blur belongs to the **review step in the popup, before Export**. The viewer only displays the already-annotated image.

**Anti-requirement:** a hosted viewer at `bugcapsule.dev` **is not part of v0.1**. It is a temptation to bolt on analytics, it directly contradicts the positioning, and it splits the focus in two. The viewer embedded in the capsule **is** the product.

## 11. Test strategy

### 11.1 Build order

```
1. packages/schema          (zod + types)
2. fixtures/                (capsule pairs for every signal class + leaking payload corpus)
3. packages/diff + tests    ← pure, does NOT need Chrome
4. packages/capsule + tests (redaction corpus + zip io)
5. playground/              (deterministic app, 2 modes)
6. apps/extension           (capture pipeline hitting the playground)
7. apps/viewer              (reads fixtures first, real capsules later)
8. apps/cli
```

Steps 1–4 give ~60% of the product **without touching a single line of Chrome API**. The diff engine and the redaction engine are pure functions — many times faster to develop and test than debugging through extension reloads.

### 11.2 `playground/`

Deterministic app, `?mode=healthy` and `?mode=broken`, running on a small HTTP server (Vite middleware) so that `fetch`/XHR **actually** run through the hooks.

| Route | healthy | broken |
|---|---|---|
| `POST /login` | 200 | 200 |
| `GET /profile` | 200 | 200 |
| `GET /permissions` | `{permissions: string[]}` | **403** `{error, code:"TOKEN_EXPIRED"}` |
| `POST /api/order` | 201 | 400 `quantity must be a number` |
| `/crash` | — | JS `TypeError` |
| localStorage | `new_auth=false` | `new_auth=true` |
| `__BUGCAPSULE_SNAPSHOT__` | `cartVersion: 2` | `cartVersion: 3` |
| `/embed` | iframe | iframe (tests `frameId`) |
| `/big` | 2MB response | tests the size cap |
| `/leak` | JWT in header + body + `console.log` | tests redaction |
| `/stream` | SSE | tests streaming skip |
| `/noisy` | 60 mixed logs (log/info/warn/error) + simulated noise from other extensions | tests console grouping + correlation |
| `?delay=` | inject latency | tests `duration-outlier` |

It is a demo, a fixture generator, and a manual QA page — three jobs in one.

### 11.3 Four test layers

1. **Unit** — normalization (ID heuristic table), classification, redaction rules (corpus-driven), zip round-trip, schema validation.
2. **Golden** — diff output for each fixture pair, snapshot test. Diff is pure, so this is the cheapest way to protect behavior and document the expected output.
3. **Integration (Playwright + persistent context)** — kept narrow: (a) the extension loads, (b) capturing the playground produces a capsule with the correct event counts, (c) the leak canary. MV3 SW testing will be flaky — push logic down to the unit level.
4. **Security** — zip-slip + zip-bomb on the CLI.

### 11.4 Leak canary

Plant known secrets into the playground (`Authorization: Bearer SUPERSECRET_CANARY_12345`, a `password` field, a JWT in localStorage), capture for real, then **assert that those strings do not appear in any byte of the zip** (read raw bytes, both JSON and WebP).

This is the only test that, if it fails, the product loses its right to exist. **Write it before writing the redaction engine.**

Also add a **diff determinism test**: run twice, assert the output is byte-identical (catching timestamps that leaked into the output).

## 12. Scope v0.1

### In scope

Capture (URL/env, annotated screenshot + blur pre-export, console errors, failed fetch/XHR, actions, 30s ring buffer) · 2-layer redaction + hash mode · `.bugcap` export/import · offline viewer · compare 2 capsules · state diff (storage + snapshot hook) · API schema diff · opportunistic baseline · fidelity manifest · diff signal classes · CLI `open`/`diff`.

### Out of scope (recorded in the README)

Video · DOM replay · backend · account · cloud sync · Jira · AI · WebSocket/SSE **bodies** · Web Worker capture · hosted viewer · HAR export · body-similarity matching · global entropy redaction · Firefox/Safari · MV2 · multi-user salt management UI.

### Milestones

| Milestone | Content | What it demos |
|---|---|---|
| **M1** | schema + fixtures + diff + capsule (steps 1–4 §11.1) | `bugcapsule diff a.bugcap b.bugcap` on hand-written capsules — **killer feature proven, no browser needed yet** |
| **M2** | playground + extension capture + redaction | real capture from Chrome, canary test green |
| **M3** | viewer + annotate + blur | dev opens the file, sees diff + image |
| **M4** | baseline + CLI + snapshot hook + internal rollout | tester clicks one button, dev receives the diff ready-made |

**Each milestone is its own implementation plan.** The first plan targets M1. Do not write one giant plan for all four milestones — the interfaces of M2–M4 will change once M1 shows how the diff engine actually behaves.

If time runs out after M2, there is still a real artifact + diff engine, only the UI is missing — rather than a half-finished extension that proves nothing.

## 13. Risks

| # | Risk | Level |
|---|---|---|
| 1 | False-positive diffs erode trust → devs stop opening capsules | 🔴 Highest |
| 2 | Enterprise policy blocks sideloading → must go Web Store unlisted + wait for review | 🔴 |
| 3 | Real apps are more varied than the playground (GraphQL, micro-frontends, SSR hydration) and break the capture assumptions | 🟠 |
| 4 | `storage.session` quota + offscreen lifetime not yet verified | 🟠 |
| 5 | Novelty of the diff not yet verified (web search unavailable in this session) | 🟠 affects positioning |
| 6 | The `postMessage` bridge is not a security boundary | 🟡 |
| 7 | `.bugcap` blocked by corporate email | 🟡 |
| 8 | Baseline = retention by default | 🟡 |
| 9 | Playwright + MV3 SW flaky | 🟡 |

## 14. Open questions to verify before coding

No claim below is verified in this session (web search unavailable; `web_fetch` into Chrome docs returned only the navigation bar). Needs confirmation before M2:

| Claim | Impact | Source to check |
|---|---|---|
| `chrome.webRequest` cannot read response bodies | Decision §6 (hooks are the only source for bodies) | developer.chrome.com/docs/extensions/reference/api/webRequest |
| `chrome.storage.session` quota ~10MB; `unlimitedStorage` does not apply | §6.2 | developer.chrome.com/docs/extensions/reference/api/storage |
| `world: "MAIN"` is available for content scripts registered in the manifest | §6.1 | developer.chrome.com/docs/extensions/develop/concepts/content-scripts |
| `chrome.tabs.captureVisibleTab` is limited to 2 calls/second; viewport only | §10 | developer.chrome.com/docs/extensions/reference/api/tabs |
| `debugger` cannot be declared as an optional permission | §3 D1 | developer.chrome.com/docs/extensions/reference/api/debugger |
| `optional_host_permissions` + onboarding pattern | §3 D3 | developer.chrome.com/docs/extensions/reference/api/permissions |
| Whether the offscreen document is closed by Chrome after idle | §6.2 (option B was rejected) | developer.chrome.com/docs/extensions/reference/api/offscreen |
| Whether OpenJam / Jam / Brie have a working-vs-broken diff | §2 positioning | jam.dev, OpenJam repo, brie |
| WXT vs CRXJS: version + support for `world: MAIN`, offscreen, multi-entry | §4.1 | wxt.dev |
| Playwright supports testing MV3 extensions | §11.3 | playwright.dev/docs/chrome-extensions |
| Chrome Web Store review with broad host permissions | §13 #2 | developer.chrome.com/docs/webstore |

## 15. v0.1 success criteria

1. A tester clicks one button, the `.bugcap` file downloads, and **nothing leaves the machine**.
2. The canary test is green: not one byte of any planted secret appears in the artifact.
3. A developer opens `viewer.html` by double-click and sees the ranked diff in **< 5 seconds**, with nothing to install.
4. On the playground's `/noisy` route (60+ logs): grouping + correlation reduce it to ≤ 3 signal lines.
5. In one real team bug: the dev can say "ah, there it is" without asking QA another question.
6. At least one real bug is fixed without manual reproduction.
