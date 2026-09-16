# BugCapsule

**Send me the bug, not the screenshot.**

BugCapsule captures the **shape** of a broken session — never its values — so two runs
of the same flow can be **diffed by default**, offline, in a single portable file.

[![CI](https://github.com/iamkhai-ai/BugCapsule/actions/workflows/ci.yml/badge.svg)](https://github.com/iamkhai-ai/BugCapsule/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![format 0.1.0](https://img.shields.io/badge/format-0.1.0-informational.svg)](spec/bugcap-v0.1.md)

---

## The problem

A tester hits a bug and sends a screenshot. The screenshot cannot tell you that
`POST /api/checkout` went from `201` to `500`, that `response.orderId` disappeared, that
a feature flag flipped, or that the request was retried once. So you spend an afternoon
reproducing a bug that the browser already knew the answer to.

The usual fix is to record everything. That means uploading someone's session — including
their tokens, their payloads, their storage — to somebody's server.

BugCapsule takes a different route: **capture structure instead of values.** Most of what
makes a bug findable is shape, not content. A field disappearing is a shape change. A
field becoming nullable is a shape change. A status moving from `2xx` to `5xx` is not
content at all. So a capsule that never stores a single value still answers most of the
questions.

## What it produces

Two `.bugcap` files, one from a run that worked and one from a run that broke, and a
ranked list of signals with the root cause first.

```
$ pnpm show:diff
------------------------------------------------------------------------
BugCapsule diff
  baseline  fixture-checkout-working  (working)
  candidate fixture-checkout-broken  (broken)
  first anomaly at 5102ms
------------------------------------------------------------------------

Visible signals (12)

  1. [w3] network     POST /api/checkout
     POST /api/checkout moved from 2xx to 5xx
     201 -> 500
     confidence=high  proximity=+0ms  id=network|POST /api/checkout?token||status-class-change
     why: HTTP status changed class — this is usually the root cause, not a symptom

  2. [w3] network     POST /api/checkout
     POST /api/checkout → response.error newly appeared (string)
     (absent) -> "string"
     confidence=high  proximity=+0ms  id=network|POST /api/checkout?token|response.error|presence-change
     why: body shape is structure, not values — this signal does not depend on capturing the body

  3. [w3] network     POST /api/checkout
     POST /api/checkout → response.etaDays disappeared (previously number)
     "number" -> (absent)
     confidence=high  proximity=+0ms  id=network|POST /api/checkout?token|response.etaDays|presence-change
     why: body shape is structure, not values — this signal does not depend on capturing the body

  ... 9 more signals (4-12), omitted here ...

Hidden by default (0)

Dropped as noise (0 kinds)

Suppressed (0)
------------------------------------------------------------------------
```

That is real, unedited output from `pnpm show:diff`, run against the two committed fixture
capsules. Signals 4–12 are omitted only to keep this readable; nothing inside the shown
signals is edited.

Note that **neither fixture captures a response body.** Every one of those shape signals
comes from `bodyShape`, so the diff works with values capture switched off. That is the
whole point.

## Why the privacy claim is checkable

Most tools *promise* not to collect sensitive data. BugCapsule makes the promise
falsifiable:

- **`bodyShape` is the default.** A minimal type tree (`object` / `array` / `string` /
  `number` / `boolean` / `null` / `anyOf`) is derived inside the page. Only the shape
  crosses into the capsule. Values never leave page context.
- **`privacy.json` is a verified claim, not a promise.** If the policy says bodies are
  not captured and a body is present, the capsule is **invalid**
  (`privacy-claim-violated`). `writeCapsule` refuses to produce it and the validator
  rejects it. A producer cannot claim one thing and do another.
- **There is no headers field in v0.1 at all.** Removed fields are *reported by name* in
  `privacy.redaction.removedFields`, because "was an `authorization` header sent" is a
  real debugging question.
- **Cookies contribute names only, never values.** A missing `Set-Cookie` is one of the
  most common auth bugs, and it is a change in key presence, not in value.

## Status

This is a **format and a diff engine**. There is no browser extension yet — be clear about
that before adopting it.

| Component | State |
|---|---|
| `@bugcapsule/format` — schemas, types, validator, `.bugcap` reader/writer | built, tested |
| `@bugcapsule/diff` — diff engine | built, tested (18 tests) |
| `@bugcapsule/fixtures` — deterministic fixture capsules (private) | built |
| `spec/bugcap-v0.1.md` — frozen format contract | written |
| `spec/0.1/*.schema.json` — 7 published JSON Schemas | generated from the zod source |
| Capture tool (Chrome extension) | **not started** |
| Viewer / UI | **not started** |

**105 tests pass.** CI enforces three things that are otherwise just claims: the generated
JSON Schema cannot drift from the zod source, the committed fixture capsules must
regenerate byte-for-byte, and the suite must be green on Node 22 and 24.

## Quick start

Requires Node >= 22.12 and pnpm 11.

```bash
pnpm install
pnpm test            # 105 tests
pnpm typecheck
pnpm check:schemas   # fails if the committed JSON Schema drifted from the zod source
pnpm gen:fixtures    # regenerates fixtures/*.bugcap deterministically
pnpm show:diff       # prints the diff of the working/broken fixture pair
```

## Repository layout

```
packages/format/     zod schemas, inferred types, validator, .bugcap reader/writer
packages/diff/       diff engine: turns two capsules into ranked signals
packages/fixtures/   deterministic fixture generators (private, dev-only)

spec/bugcap-v0.1.md  the frozen format contract
spec/0.1/            published JSON Schema, generated from the zod source
fixtures/            three committed .bugcap binaries
docs/prior-art.md    what already exists, and what this project must not claim
docs/design/         the original design document, kept as a historical record
```

Zod is the single source of truth. The JSON Schema is an **output** of the workflow, not
an input, so the types, the validator and the published contract cannot drift apart.

## Compatibility contract

| Case | Reader behaviour |
|---|---|
| Different `MAJOR` | **Refuse**, with a reason. Never guess. |
| Same `MAJOR`, higher `MINOR` | Read, with a warning. Unknown fields are ignored. |
| Same `MAJOR`, lower or equal `MINOR` | Read normally. |
| `PATCH` | Ignore. |
| Malformed version | Refuse with a reason; never throw out of the API. |

Readers must ignore unknown fields. Producers should reject them, to catch typos at
capture time. See [the spec](spec/bugcap-v0.1.md) for the full contract and the invariants
JSON Schema cannot express.

## Prior art — and what this is not

[`docs/prior-art.md`](docs/prior-art.md) surveys the landscape before this project claims
anything. The honest summary, because overclaiming here would be easy:

**Not novel, and not claimed:**

- Capturing console, network and browser state — Jam, LogRocket, OpenReplay, Bird Eats Bug
  and others all do this, and OpenReplay's docs even call it "DevTools-grade".
- Local-first, single-file, no-backend, opens-offline reporting — OpenJam already does
  exactly this.
- Diffing two JSON payloads field by field — `chrome-network-differ` ships a "Deep JSON
  Diff Engine" that highlights added, removed and changed fields.
- Baseline-vs-current diffing in general — that is a crowded category: visual regression
  tooling alone accounts for over a thousand repositories, and OpenAPI spec diffing has
  mature, heavily-used tools.
- Inferring schemas from captured traffic — a project with ~9,600 stars does this.

**What survived the survey, stated narrowly:**

1. No bug-capture or session-replay product we looked at **documents comparing two
   captures at all**.
2. No product documents comparing the **shape or schema of JSON responses** — not even as
   a manual feature.
3. Nobody captures **structure instead of values by default**, and nobody publishes a
   **versioned format with a machine-checkable privacy claim** for it.

Point 3 is the one worth building on: a format is infrastructure for other people to build
against, which is a different kind of contribution from a UI product. The prior art
document also lists what remains unverified, and it is explicit that "no public evidence
found" is not the same as "does not exist".

## License

Apache-2.0. Copyright 2026 Nguyễn Quang Khải. See [LICENSE](LICENSE).
