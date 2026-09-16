# BugCapsule capture tool (Chrome extension) — design

- **Date:** 2026-09-16
- **Status:** design approved in review; this document is awaiting spec review
- **Milestone:** A — produce a real, valid `.bugcap` from a real page, verified in a real browser
- **Supersedes for this subsystem:** `docs/design/bugcapsule-design.md` §"extension" (that
  document stays as the historical record of what was planned; where the two disagree, this
  document wins, because this one was written against the format as actually implemented)

---

## 1. What this milestone delivers

A Chrome extension, built from `packages/extension`, that a tester can install unpacked and use
to turn a live page into a `.bugcap` file.

Success is defined by properties that can be checked, not by the feature existing:

1. Clicking capture on a page produces a `.bugcap` that `readCapsule` can open and
   `validateCapsule` reports as valid.
2. The capsule contains a `bodyShape` for JSON responses and **no body values anywhere in its
   bytes**, on a page that deliberately returns a secret string.
3. A password field produces an action entry with `valueCaptured: false` — no record that
   anything was typed at all.
4. `privacy.json` in a real capsule describes what the extension actually did.
5. All of the above are asserted by an automated test that runs a real Chromium with the real
   extension loaded. None of it rests on inspection by hand.

Point 5 is the load-bearing one. Everything else is a claim this milestone is built to earn.

## 2. Decisions locked here

| # | Decision | Chosen | Rejected alternatives |
|---|---|---|---|
| E1 | Milestone scope | Capture only: one capsule per click, no comparison UI | Pair flow; in-popup diff |
| E2 | Verification | Real Chromium in CI (Playwright) **plus** unit tests | Unit tests only; browser local-only |
| E3 | Capture content | Everything the format supports | Dropping `actions`; dropping `state` |
| E4 | How bytes reach disk | Service worker assembles, an **offscreen document** downloads | Popup downloads; persist-then-export page |
| E5 | Storage capture shape | Snapshot at click time, read from the ISOLATED bridge | Hook `localStorage` setters as an event stream |
| E6 | `build` source | Follow the convention already documented in `environment.ts` | Invent a new tag only |
| E7 | Spec fix for the policy gap | Correct the prose in §11; keep `formatVersion` `0.1.0` | Bump the version |

## 3. Inherited decisions, not revisited

Locked in `docs/design/bugcapsule-design.md` and still binding: **D1** toolbar popup with early
injection (`world: "MAIN"`, `run_at: "document_start"`) and **no `chrome.debugger`**; **D3**
`optional_host_permissions` with a per-domain allowlist; **D5** the service worker owns capture
state, with redacted metadata in `chrome.storage.session`.

From the format spec (`spec/bugcap-v0.1.md`): the ring buffer has no Start/Stop; capture is
shape-by-default with denylist redaction at a single choke point; `writeCapsule` is strict and
`readCapsule` is lenient; a salt used for hashing is never stored in the capsule; there is no
`headers` field in v0.1.

## 4. Architecture — four runtimes

The extension is four separate JavaScript contexts, because Manifest V3 does not offer a choice
about some of these splits. Each was verified to work in the spike (Appendix A).

```
┌─ probe (MAIN world, document_start, all_frames) ─────────────────────┐
│  Installs hooks before the page's own code runs. Sees values.        │
│  Converts values to shape and metadata IN THE PAGE.                  │
│  Has no chrome.* API — this is a property of the MAIN world.         │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ MessageChannel port, shape + metadata only
┌──────────────────────────▼───────────────────────────────────────────┐
│  bridge (ISOLATED world)                                             │
│  Adopts the port, relays to the service worker.                      │
│  Reads the storage snapshot (it shares localStorage and cookies      │
│  with the page, so MAIN is not needed for this).                     │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ chrome.runtime.sendMessage
┌──────────────────────────▼───────────────────────────────────────────┐
│  service worker                                                      │
│  Owns the ring buffers. On capture: freezes the window, calls         │
│  chrome.tabs.captureVisibleTab, assembles the archive, runs           │
│  writeCapsule (strict).                                              │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ bytes (ArrayBuffer)
┌──────────────────────────▼───────────────────────────────────────────┐
│  offscreen document                                                  │
│  Blob URL + chrome.downloads.download. Needs a DOM context because    │
│  URL.createObjectURL does not exist in a service worker.             │
└──────────────────────────────────────────────────────────────────────┘
                           ▲
                    popup (React) — role selector, capture button,
                    error display, and the home of the diff UI later
```

Why the offscreen document rather than the popup, which would be one fewer moving part:
**Chrome closes a popup as soon as it loses focus.** Capture is a one-shot user action lasting a
few hundred milliseconds, and clicking elsewhere during that window is easy and ordinary.
Putting the download in the popup adds a real, very visible failure mode — "I clicked and nothing
happened" — in exchange for one less permission. The offscreen document is the context MV3
provides precisely for "needs DOM, presents no UI".

## 5. Data flow and the privacy boundary

The privacy claim is enforced by where values are allowed to exist. Stated precisely, because
saying "no values leave the page" would be false:

Two boundaries matter here, and they are not the same boundary.

**Probe → bridge, never sent:** request body values, response body values, storage values,
console argument objects, cookie values, header values.

**Probe → bridge, sent:** body shapes, key names, `valueType`, header *names* that were withheld,
console message text, and metadata (status, duration, offsets, selectors).

**Bridge → service worker:** that same payload, plus the storage snapshot. The snapshot carries
key names and `valueType`; it carries storage *values* only when `policy.storageValues` is true,
which the extension leaves false by default (§7). So by default no storage value leaves the page
context either — but the field exists in the format, and claiming it could never happen would be
false. Cookie values and header values do not cross this boundary under any setting.

Console message text is the deliberate exception. It is text the user can already see in
devtools, it is the single most useful artifact in a bug report, and it is filtered by the
denylist like everything else. Pretending it does not cross would be the kind of overclaim this
project has already had to walk back once.

**Consequence that must be stated honestly:** deriving `bodyShape` requires *reading* the body.
The probe reads it, derives the shape, and discards the value inside the page context. This
matters for what `privacy.json` may say — see §11.

**The choke point is one function.** The probe has exactly one exit: a function that takes an
internal capture record and returns the payload for the bridge. Everything else in the probe is
forbidden from calling `postMessage` directly. This makes the privacy property testable by
pointing a test at a single boundary rather than auditing the whole file.

## 6. Component responsibilities

### 6.1 `probe.main.ts` — MAIN world, `document_start`, `all_frames: true`

- Must be a **self-contained IIFE**. MV3 content scripts cannot be ES modules, so Vite inlines
  every dependency. It reuses `valueToBodyShape` from `@bugcapsule/format` at build time rather
  than reimplementing the shape algorithm.
- Installs hooks synchronously at document start, before any page code: `fetch`,
  `XMLHttpRequest`, `console.*`, and `history.pushState`/`replaceState`.
- Registers capture-phase listeners for `click`, `input`, `change`, `submit`, `keydown`.
- Mints a `docId` per document and reports its `frameId`.
- Owns the single exit function described in §5.

### 6.2 `bridge.isolated.ts` — ISOLATED world

- Performs the port handshake: the probe creates a `MessageChannel`, posts one port to `window`
  with a per-document random nonce, and the bridge adopts the port whose nonce matches. A second
  handshake from anything else is ignored.
- Relays payloads to the service worker.
- Reads the storage snapshot on demand and returns key names, `valueType`, and — only when
  `policy.storageValues` is true — values, plus `document.cookie` **names**.
- Exists solely because the MAIN world has no `chrome.*`. It holds no policy logic of its own; if
  it did, there would be two places where the privacy rules could drift.

### 6.3 Service worker

- Owns all buffers, keyed by `(tabId, docId)`, in memory, with redacted metadata mirrored to
  `chrome.storage.session` so a worker restart does not silently lose the session (D5).
- On capture: freezes the window, calls `chrome.tabs.captureVisibleTab`, requests the storage
  snapshot from the bridge, assembles the archive, and runs `writeCapsule`.
- `writeCapsule` is strict on purpose. A malformed archive must fail here, loudly, rather than
  produce a file that a third party opens and cannot trust.
- Hands the bytes to the offscreen document.

### 6.4 Offscreen document

- Receives bytes, builds a `Blob`, creates an object URL, calls `chrome.downloads.download`, then
  revokes the URL.
- Filename pattern: `<origin-host>-<YYYY-MM-DD>-<HHmmss>-<role>.bugcap`.
- No logic beyond delivery. It must not be a place where capsule content is inspected or
  transformed, because anything it did there would be invisible to the tests that check the
  assembled archive.

### 6.5 Popup (React + TypeScript)

- Role selector (`working` / `broken` / `unknown`, default `unknown`), a capture button, and a
  status area that shows either the resulting filename or the concrete failure reason.
- Requests host permission for the current origin on first capture for that origin.
  `chrome.permissions.request` requires a user gesture, and the click inside the popup is one.
- Contains no capture logic. It is a control surface.
- This is where the diff UI will live in a later milestone, which is a reason to keep it thin now.

## 7. What is captured, section by section

Field names below are the ones in `spec/0.1/*.schema.json` and are not approximate.

### `environment`
`browser` and `os` from user-agent client hints; `viewport` from the page
(`innerWidth`/`innerHeight`/`devicePixelRatio`); `locale` from `navigator.language`; `timezone`
from `Intl.DateTimeFormat().resolvedOptions().timeZone`; `network.online` from `navigator.onLine`;
`document.visibilityState`; `build` from, in order, `window.__BUILD_ID__`,
`<meta name="bugcapsule-build">`, `<meta name="build">`. **If none is present, the field is
omitted.** A guessed build identifier is worse than a missing one.

The schema comment in `environment.ts` already names `<meta name="build">` and
`window.__BUILD_ID__`; this design follows that convention and adds only the namespaced tag as a
last resort for pages whose generic `build` meta means something else.

### `actions`
Events of type `click`, `input`, `change`, `submit`, `keydown`, plus synthetic `navigation`
events from `popstate`/`hashchange` and the history hooks.

`target.selector` comes from a strategy chain, and `target.strategy` records which link produced
it: `testid` (`data-testid`, `data-test`, `data-cy`) → `id` → `aria` (`aria-label`, role +
accessible name) → `stable-attribute` (`name`, `type`, `href` path) → `structural` (shortest
unique path). The strategy is recorded rather than hidden so a consumer can judge how brittle the
selector is.

**Input values are never stored — for any input type.** The schema offers only
`metadata.valueCaptured` and `metadata.valueLength`; there is no value field for actions at all.
For `inputType === 'password'`, `valueCaptured` is `false`: not even the fact that something was
typed is recorded. `valueLength` is omitted rather than zeroed for password fields.

### `network`
Only `fetch` and `XMLHttpRequest`, because `chrome.webRequest` cannot read response bodies. This
is the reason the format has `network.json` and not a `.har`: a hook installed in the page is the
only place a body is ever visible.

Per request: `method`, `url` (`UrlRef`), `status`, `durationMs`, `resourceType`, plus `request`
and `response` objects. Each side carries `contentType`, `bodyCaptured`, and — when
`policy.bodyShapes` is true — `bodyShape`, derived from a **clone** so the page's own stream is
untouched. The response body is read asynchronously and never awaited on the page's path.

When a body is not captured, `omissionReason` uses one of the five values the schema allows:
`disabled` (policy off), `sensitive` (denylist hit), `unsupported` (not JSON, so no shape can be
derived), `size-limit` (over 64 KB per side), `capture-failed` (the clone or parse threw). Note
that `omissionReason` has no value meaning "the body was unreadable in principle"; that case is
`unsupported`.

Query strings keep their values except for keys on the denylist, so `?tab=settings` survives and
`?token=…` becomes `<redacted>`. Keys that were redacted are listed in
`privacy.redaction.removedFields.queryKeys`.

### `console`
`error`, `warn`, `info`, `debug`, `log`. `message` is the serialized form of the arguments with a
depth limit, a size limit and cycle safety. `args` is populated only when
`policy.consoleVerbose` is true. `source` is `page`, `extension`, or `unknown` — the default when
provenance cannot be established is `unknown`. Guessing `page` would manufacture a false
accusation against the app, which is exactly the failure this format exists to avoid.

### `state`
A **snapshot at click time**, read from the ISOLATED bridge. `localStorage` and `sessionStorage`
give `key` plus `valueType`; `value` is present only when `policy.storageValues` is true, which
the extension leaves false by default. `cookieNames` holds names only, never values.

That this is a snapshot and not an event stream is settled by the format: `StateFileSchema` has
no `offsetMs` and no `seq`, unlike every event-shaped section.

### `privacy`
Not a description of the extension's defaults but a record of what this capture actually did:
`policy` with the six booleans the schema requires, and `redaction.applied` plus
`redaction.removedFields` populated from real encounters. `removedFields.headers` lists the
**names** of request headers that were present and withheld — the probe reads header names in
order to know they existed, and never keeps values.

### `screenshot`
`chrome.tabs.captureVisibleTab`, PNG, stored rather than deflated, capped at 2 MB. Above the cap
the screenshot file is omitted and `captureGaps` records it.

### `manifest`
`format: 'bugcapsule'`, `formatVersion`, a fresh `id`, `createdAt` at completion,
`source: {name: 'bugcapsule-extension', version}`, `capture.startedAt/endedAt/durationMs` from
the frozen window, `role` from the popup, `page` as a `UrlRef` of the top document, `files`
computed by the writer from the entries actually written, and `captureGaps`.

Real capsules are **not** byte-deterministic: they carry a real timestamp and a real screenshot.
Determinism is a guarantee about the committed fixtures only. Nothing here weakens that
guarantee, and this document says so explicitly so that no future reader concludes otherwise.

## 8. Ring buffer semantics

- Starts at `document_start` on allowlisted origins. No Start/Stop control exists.
- Keyed by `(tabId, docId)`; a navigation produces a new `docId`, so an old document's events are
  never mixed into a new one.
- Caps: **500 events total**, 200 network, 200 console, 100 actions, and a **30 s** window.
  Whichever limit is reached first, the oldest entry is evicted.
- On capture: freeze the window ending at the click instant, take the last 30 s or the last N
  events, whichever is smaller. Capture is a snapshot of that frozen set; later events cannot
  enter it.

## 9. Permissions

`storage`, `downloads`, `offscreen`, `scripting`, `activeTab`, plus `optional_host_permissions`
for the allowlist (D3). No `chrome.debugger` (D1). No `cookies` permission: cookie names are read
from `document.cookie` in the bridge, which needs no permission and returns only what the page
itself can already see.

## 10. Error handling and degradation

The rule: **degrade a section, never the honesty of the capsule, and never write a file that
fails validation.**

| Situation | Behaviour |
|---|---|
| Origin not permitted, user declines | Capture aborts. No file. Popup names the reason. |
| Probe injected after page start | Capture proceeds; `captureGaps` gains `missed-before-inject`. |
| Service worker restarted mid-session | The buffer is restored from the `chrome.storage.session` mirror, which is flushed in batches, so events since the last flush — at most 500 ms — are missing; `captureGaps` gains `sw-restarted`. |
| `captureVisibleTab` fails | Screenshot omitted; `captureGaps` gains `screenshot-unavailable`. The rest of the capsule is still produced. |
| Response body over 64 KB | `bodyCaptured: false`, `omissionReason: 'size-limit'`, no shape. |
| Response body is not JSON | `omissionReason: 'unsupported'`, no shape. |
| Body clone or read throws | `omissionReason: 'capture-failed'`. |
| Denylist matches a value | `omissionReason: 'sensitive'`; the key name is recorded in `removedFields`. |
| Page has workers or cross-origin iframes | Not captured; `captureGaps` gains `workers-not-captured` or `cross-origin-frames-not-captured` respectively. |
| Archive fails strict validation | **No file is written.** The popup shows the validation error. A malformed capsule that looks fine is worse than no capsule. |

Redaction fails closed: if the redaction step cannot complete for an entry, the entry is dropped
and counted, never emitted raw.

## 11. The v0.1 policy gap this milestone exposed

`spec/bugcap-v0.1.md` defines `policy.responseBodies: false` as **the body was never read**. The
extension reads bodies in order to derive `bodyShape`, so under that definition an extension
capsule declaring `responseBodies: false` while carrying a `bodyShape` would be making a false
statement — precisely the class of statement `privacy-claim-violated` exists to catch.

`validateCapsule` does not currently flag it, and should not: the only `bodyShape` invariant in
`validate.ts` is that `bodyShape` must be absent when `policy.bodyShapes` is false. The pair
(`bodyShapes: true`, `responseBodies: false`) already describes the situation correctly. What is
missing is that the spec never says `bodyShapes: true` **implies the body was read, in page
context, to derive the shape, with the value discarded**.

**Resolution (E7):** state that implication explicitly in the spec's prose — in §5
(`privacy.json`, for the policy semantics) and §11 (the shape language, for the derivation rule).
No schema changes. `formatVersion` stays `0.1.0`, because no field changes meaning and no
external implementation exists yet. The change is a clarification of an underspecified
implication, not a contract change, and it is recorded here so that it is visibly a decision
rather than an oversight.

This is also why the e2e test asserts the pair together (§12): the claim and the artifact must be
checked as a unit.

## 12. Testing

### Layer 1 — unit tests (vitest), for `packages/extension/src/core/`

Everything here is pure: no `chrome.*`, no DOM globals beyond what a test supplies.

- **Ring buffer:** cap enforcement, eviction order, freeze-window semantics, per-`docId`
  isolation.
- **The privacy boundary:** given a capture record containing known secret strings, serialize
  what the single exit function produces and assert that **none of those strings appear**. This is
  the most important unit test in the package. It is a property test, not a spot check.
- **Selector strategy chain:** `testid` beats `id` beats `aria`, and the recorded `strategy`
  matches the link that actually produced the selector.
- **Password invariant:** `inputType === 'password'` implies `valueCaptured: false` and no
  `valueLength`, for every code path that can emit an action.
- **Query redaction:** denylisted keys are redacted, non-denylisted keys keep their values.
- **`UrlRef` construction** from absolute, relative and malformed URLs.
- **`captureGaps`** codes are emitted for each degradation path in §10.
- **Assembly:** a well-formed archive is accepted by `writeCapsule`; a deliberately violating
  archive makes `writeCapsule` **throw**. The negative half matters more than the positive half.

### Layer 2 — end-to-end (Playwright), `packages/extension/e2e/`

Launch a persistent Chromium context with `--disable-extensions-except` and `--load-extension`,
using **`channel: 'chromium'` and `headless: true`**. Then serve a local page that fetches JSON
containing a known secret string, logs to the console, writes `localStorage`, and renders a form
with a password field and a `data-testid` button. Drive a capture, then assert against the
downloaded file:

- The file exists and `readCapsule` opens it.
- `validateCapsule` reports valid.
- The network entry for the JSON call has a `bodyShape`.
- The response's secret string **does not occur anywhere in the capsule's bytes** — checked
  against the raw archive, not against a parsed field, so a leak into any section is caught.
- The password field's action has `valueCaptured: false`.
- `privacy.json` has `policy.bodyShapes: true` and `policy.responseBodies: false` together (§11).
- `captureGaps` matches what the fixture page should produce.

**The launch options are load-bearing, and the test must fail loudly if they regress.** The spike
showed that `headless: true` **without** `channel: 'chromium'` silently loads no extension at
all: no service worker, no content script, no hooks, and no error. A test suite written that way
would either fail for the wrong reason or, worse, pass while testing nothing. Therefore every
e2e test asserts the service worker is present before doing anything else, so that a future
change to the launch options produces an immediate, legible failure.

### CI

A separate job installs Chromium (`playwright install --with-deps chromium`) and runs the e2e
suite alongside the unit tests. It runs in addition to — never instead of — the existing verify
job, which continues to guard schema drift, fixture determinism and the existing suite.

The e2e job has never run on GitHub. It is verified locally on Windows only. The CI leg is
therefore a genuine test of an unverified claim, in the same spirit as the Node 22 leg, and if it
fails, the thing that is wrong is this paragraph.

## 13. Build and packaging

- New package `packages/extension`, private, built with Vite to `dist/` for unpacked loading.
- `vite.config.ts` exports an **array of two configs**: ESM for the service worker, popup and
  offscreen page; an **IIFE** build for the two content scripts. This is not a preference.
  MV3 content scripts are not modules, so a shared ESM chunk cannot be loaded into the page.
- `manifest.json` is a static source file copied into `dist/`, with a test asserting its
  `version` equals `package.json`'s — the same anti-drift pattern the repository already uses for
  JSON Schema and fixtures.
- The popup is React 19 + TypeScript, matching the existing toolchain.
- New devDependency: `playwright@1.63.0` (published 2026-09-04, so it satisfies the repository's
  `minimumReleaseAge` policy).

## 14. Explicitly out of scope

- **Any diff UI.** Milestone C. The diff engine already exists and is tested; this milestone
  produces the input it consumes.
- **The opportunistic baseline** sketched at L492 of the older design document. It is a good idea
  and the architecture leaves room for it, but it means retaining redacted session data beyond
  the working session, which is a change in the privacy posture that document already flagged. It
  needs its own decision, not a quiet inclusion here.
- **A domain onboarding page.** Permission is requested per origin from the popup. A management UI
  can follow.
- **Capturing Web Workers, cross-origin iframes, WebSockets, or `navigator.sendBeacon`.** Each is
  declared in `captureGaps` rather than silently absent.
- **Cookies permission and cookie values.** Names only, read from `document.cookie`.
- **The viewer.** A `.bugcap` still needs `pnpm show:diff` or a future viewer to be read by a
  non-developer, and that remains the largest gap in the product story. It is not this milestone.

## 15. Open items and accepted risks

1. **The e2e job has never run on GitHub.** Locally verified on Windows; the Linux CI leg is
   unverified (see §12).
2. **Playwright's extension support is Chromium-only.** Firefox and Safari are out of reach for
   this test strategy. This is acceptable for a Chrome extension and should be stated in the
   README rather than discovered by a contributor.
3. **The bridge handshake is a security boundary.** The nonce must be generated with
   `crypto.getRandomValues` per document, and a foreign page must not be able to adopt the port.
   A hostile page that could do so could inject fabricated events. The handshake is covered by an
   e2e test that asserts a page-supplied `postMessage` with a wrong nonce is ignored.
4. **`chrome.storage.session` is not a durable store.** It survives worker restarts but not
   browser restarts. Capsules pending at browser shutdown are lost; the popup must therefore never
   imply that a capture is safe before the file lands on disk.
5. **Body reading has a cost.** Cloning and parsing every JSON response is real work on real
   pages, and on a page with heavy polling it is measurable. §8's caps bound memory, not CPU. If
   this proves intrusive in dogfooding, the mitigation is a size threshold before parsing rather
   than abandoning shape derivation.
6. **`data-cy` and `data-test` are guesses at conventions** beyond `data-testid`. They are cheap
   and reversible; listed here so the choice is visible.

## Appendix A — spike evidence

Run on 2026-09-16, Windows, Node 24.19.0, `playwright@1.63.0`, against a throwaway MV3 extension
(`world: "MAIN"`, `document_start`, `all_frames: true`) and a local page whose first inline script
records whether the MAIN-world marker already existed.

```
=== headless, channel=chromium (new headless) ===
  service worker registered: YES sw.js
  chrome.storage.session from SW: {"sessionStorage":"from-test","hasChrome":true}
  MAIN world probe present : YES
  page saw it at parse time: YES - beat app code
  fetch wrapped            : YES
  fetch calls observed     : 1

=== headless=true, no channel (old headless) ===
  service worker registered: NO
  MAIN world probe present : NO
  page saw it at parse time: false
  fetch wrapped            : NO

=== headed ===
  (identical to the new-headless run)
```

Three findings, each of which changes the design:

1. `world: "MAIN"` at `document_start` genuinely beats page code, so the `fetch` hook is in place
   before the app can capture a reference to the original. This was the primary feasibility risk
   and it is retired.
2. `chrome.storage.session` is reachable and usable from the service worker, so D5 is
   verifiable rather than merely intended.
3. `headless: true` without `channel: 'chromium'` loads **no extension at all**, silently. This
   became §12's loud-failure requirement.

The spike code was throwaway and lived outside the repository. It is not kept.

## Appendix B — field names this design relies on

Verified against `spec/0.1/*.schema.json` and the zod sources, not from memory:

- `manifest`: `format`, `formatVersion`, `id`, `createdAt`, `source{name,version}`,
  `capture{startedAt,endedAt,durationMs}`, `role?`, `page?`, `files?`, `captureGaps?`
- `files` keys: `environment`, `actions`, `network`, `console`, `state`, `privacy`, `screenshot`
- `network.requests[]`: `id`, `docId`, `frameId`, `offsetMs`, `seq`, `method`, `url`, `status`,
  `durationMs`, `resourceType`, `request`, `response`
- `request`/`response`: `contentType?`, `bodyCaptured`, `body?{type,value}`, `bodyShape?`,
  `omissionReason?` ∈ `disabled | sensitive | unsupported | size-limit | capture-failed`
- `actions.events[]`: `type` ∈ `click | input | change | submit | navigation | keydown`,
  `target{tag,selector,strategy,role?,inputType?}` with `strategy` ∈
  `testid | id | aria | stable-attribute | structural`, `url?` (a plain string, **not** a
  `UrlRef`), `metadata{valueCaptured,valueLength?}`
- `console.entries[]`: `level` ∈ `error | warn | info | debug | log`, `message`, `stack?`,
  `args?`, `source` ∈ `page | extension | unknown`
- `state`: `localStorage[]`, `sessionStorage[]` of `{key,valueCaptured,value?,valueType?}`,
  `cookieNames[]`
- `environment`: `browser`, `os`, `viewport{width,height,devicePixelRatio}`, `locale?`,
  `timezone?`, `network{online}?`, `document{visibilityState}?`, `build?`
- `privacy`: `policy{queryValues,requestBodies,responseBodies,bodyShapes,storageValues,consoleVerbose}`
  (all six required), `redaction{applied,byRule[{rule,count}],removedFields{headers,queryKeys,bodyPaths,storageKeys}}`
