# Prior art — what already exists, what is still open

- **Date:** 2026-09-16
- **Purpose:** to verify (or refute) BugCapsule's novelty claim before putting it into
  the README. This document exists to **prevent overclaiming**, not to reinforce it.

## 0. How to read this document — confidence levels

`web_search` was not usable in this environment (the plugin had no endpoint
configured). The entire survey relies on real HTTP: the GitHub REST API, the npm
registry API, original READMEs via `raw.githubusercontent.com`, and the `llms.txt` of
various docs sites (plain text, no JS required).

Each claim below carries a source label:

- **[T] — I fetched and read it myself.** Reproducible.
- **[Đ] — an authorised research pass.** The URL is recorded but I have **not**
  reproduced it myself. Credible, but not direct evidence.
- **[?] — not verified.** This document must not be used to argue for anything
  marked **[?]**.

Two kinds of bias to keep in mind:

- **This list is not exhaustive.** The GitHub API sorts by stars, so a good tool with
  few stars can fall outside the search. `chrome-network-differ` (1★) was nearly
  missed.
- **"No public evidence found" ≠ "does not exist".** An undocumented beta feature is
  not observable from the outside. The claim in section 6 is written to withstand this
  reading.

---

## 1. Short conclusion

The original claim — *"nobody has built diffing to skip the reproduce step"* — is
**wrong in that form**. Every individual piece has already been built by someone, and
some pieces are very large.

But a **narrower** version survives, and survives strongly:

1. **No product in the bug-capture/session-replay group has a feature that
   automatically compares two captures.** Capturing console/network is ubiquitous;
   **computing the diff** is absent everywhere surveyed.
2. **No documentation of any product in that group discusses comparing the
   schema/shape of a JSON response** — not even as a manual feature. This is the
   widest gap and the strongest support for the claim.
3. **Field-by-field JSON diff already exists**, in exactly one very small and
   **manual** tool (`chrome-network-differ`). This is the narrowest point that must be
   conceded.

---

## 2. Five groups of prior art

| Group | Representative | What it occupies |
|---|---|---|
| A. Bug capture / session replay | Jam, Bird Eats Bug, LogRocket, OpenReplay, Marker.io, Usersnap | **Capture** console/network/state. No diff. |
| B. Visual regression | Percy, Chromatic, BackstopJS, reg-suit + 1174 other repos | Baseline-vs-current, but on **visual output** |
| C. API spec diff | `oasdiff` (1364★), `optic` (1533★), `openapi-changes` (358★), `Azure/openapi-diff` (290★) | Diff **schema**, but on a **declared spec**, not a runtime observation |
| D. Inferring schema from traffic | `mitmproxy2swagger` (**9608★**) | Generates a spec from real traffic. **No diff.** |
| E. HAR diff | `sitespeedio/compare` (119★), `stefanjudis/har-diff` (5★), `edilec/network-waterfall-diff` (0★) | Compares two captures, but on **timing**, not structure |

### A. Bug capture / session replay — capture is ubiquitous, diff is absent

**Jam.dev [T]** — I downloaded `https://jam.dev/docs/llms.txt` myself (HTTP 200, 66
index lines, covering 70+ doc pages). Across the entire index, the number of lines
matching `diff|compare|baseline|regress` is **1**, and that is the pricing page:

> `- [Pricing](https://jam.dev/docs/pricing.md): Compare Jam plans and choose the right plan for your workspace.`

There is no comparison page. There is no `diff`/`compare` command.

Jam captures console + network, including bodies **[Đ]**:
> *"Jam captures request and response details, including bodies, for all XHR and fetch requests on the page."*

But **storage is manual only** **[Đ]**: to get localStorage the developer must call
`jam.metadata()` themselves.

**Bird Eats Bug (now Bug Capture by BrowserStack) [T]** — I downloaded
`https://docs.birdeatsbug.com/latest/reports/devtools.html` myself and read it myself.
This is the **only** product surveyed that captures storage automatically:

> *"localStorage updates (set, remove, clear) · sessionStorage updates (set, remove, clear)"*
>
> *"Bird records the method calls and **the key-value pairs** that were set, removed, or cleared. If the website being recorded is using custom localStorage or sessionStorage implementations, Bird might not record as expected."*
>
> *"The following types of data are currently not captured by our recorders: Changes to cookies · IndexedDB · Sourcemaps · Recording of activity inside iFrames embedded into the recorded page"*
>
> *"The Bird recorder captures Network requests, along with request responses..."*

Two things follow. First, storage capture is **not** ubiquitous: Bird is the exception,
and it states that it does not capture cookies/IndexedDB/iframes. Second — and this is
the direct point of contrast with BugCapsule — **Bird records the key-value pairs too**,
that is, it records the actual *value*. BugCapsule keeps key names and `valueType`, and
never keeps a value.

**LogRocket, OpenReplay, Marker.io, Usersnap, Highlight.io [Đ]** — the same shape:
console + network present, framework store relationships
(Redux/VueX/Pinia/NgRx/Zustand/MobX) present, and **no comparison feature** in the full
documentation index. Two details worth remembering:

- LogRocket has a documentation page named **"Comparisons"** — but that is *competitive
  positioning*, not a feature. Easy to misread as diff.
- **Highlight.io is dead**: the `highlight.io` domain now 301s to `launchdarkly.com`
  (it was acquired by LaunchDarkly).

### B. Visual regression — baseline diff, but on pixels

**[T]** This group is very large: GitHub has **1174 repos** matching
`visual regression in:name`, led by `Visual-Regression-Tracker` (712★) and
`cypress-visual-regression` (661★). Percy describes itself in `docs.percy.io/llms.txt`:

> *"Visual testing as a service. Get visual insight across your complete application on every commit."*

**Confidence warning:** this is the group where I **failed twice** to collect
product-level detail. `www.chromatic.com/llms.txt` → 404. `playwright.dev/llms.txt` →
404. `docs.percy.io/llms.txt` → 200 but only a 329-character stub. So the assertion
"Percy/Chromatic only diff pixels" here rests on the **name and structure of the
category** ("visual regression"), not on a quote that was read. If this document is
cited publicly, this spot needs another pass. **[?]**

What is certain: **none of the groups here compares the JSON schema of a response.**

### C + D. Schema diff exists, inferring schema from traffic exists, combining them is almost empty

**[T]** The most interesting paradox of this survey:

- API schema diff is a **mature category**: `oasdiff` 1364★, `opticdev/optic`
  1533★, `pb33f/openapi-changes` 358★, `Azure/openapi-diff` 290★. But all of them
  diff a **declared spec**, not two runtime observations.
- Inferring schema from traffic is also **mature**: `alufers/mitmproxy2swagger`
  **9608★** — *"Automagically reverse-engineer REST APIs via capturing traffic"*.
  But it does **not diff**.
- Combining those two steps — inferring schema from traffic **and then** detecting
  breaking changes — only `Akhilucky/ContractDrift` (**0★**) is attempting. Conceptually
  this is the closest prior art to BugCapsule's core, and it has no adoption.

### E. HAR diff — real, but compares timing, and is dead

**[T]** `sitespeedio/compare` (119★), README:
> *"Compare HAR files — Make it easier to find regressions by comparing your HAR files."*

But the mechanism is a **waterfall + blend slider**, inspired by the WebPageTest HAR
compare viewer. That is, it compares **load timing**, not response structure.

`stefanjudis/har-diff` (5★) — *"Tool to get diff statistics of two har-files"*.
The badges in the README are Travis CI, Gemnasium, Coveralls, gulp — all dead services
⇒ **abandoned around 2015**.

`edilec/network-waterfall-diff` (0★) — README 98 characters, *"Compare network waterfalls
across builds and show changed request costs."*

**[T]** npm registry: **no package** exists for diffing HAR/network responses.
The closest results are all general-purpose libraries (`deep-object-diff`, `diff`,
`diff-sequences`) or merely format/validate (`har-schema`, `chrome-har`).
This cell is empty.

---

## 3. Four things that look like diff but are not — and BugCapsule must distinguish itself from them

This is the part most likely to be challenged by a Reviewer, so it must be said up
front:

1. **Metric/time-series regression alerting.** OpenReplay Monitors, LogRocket
   Issues, LaunchDarkly regression detection **[Đ]**. It is statistics on an aggregate
   dashboard, not a comparison of two captures.
2. **State delta within a single session.** LogRocket shows *"the difference in state
   before and after"* a Redux action **[Đ]**. One session, one action — not
   two runs.
3. **AI similarity/summarisation.** LogRocket Galileo, OpenReplay *"Similar Sessions"*
   use embeddings to find similar sessions **[Đ]**. It is similarity, not a
   field-by-field comparison.
4. **Comparing two requests the user pinned themselves.** See section 4.

---

## 4. The closest prior art, and exactly how it differs

### `himanshuain/chrome-network-differ` — "API Differ" (1★) **[T]**

This is the **closest** thing to BugCapsule, and it must be stated plainly in the
README. Verbatim README:

> *"Side-by-Side Diff — Pin any two requests as **A** and **B** to get a structured, color-coded diff of their response bodies, request payloads, or headers"*
>
> *"Deep JSON Diff Engine — Recursively compares nested objects and arrays, highlighting added, removed, and changed fields"*
>
> *"Intercept & Capture — Automatically captures fetch and XMLHttpRequest calls on any tab with a single click"*

Concrete differences, not marketing differences:

| | `chrome-network-differ` | BugCapsule |
|---|---|---|
| Unit of comparison | Two **requests** the user pinned themselves, within one session | Two **capsules** of an entire flow |
| Pairing | Manual (the user picks A and B) | Automatic by `method + pathname + query key signature` |
| Scope | Network only | network + console + state + environment + actions |
| Headers | **Captured** | **No header field** in format v0.1 |
| Body | Captures full values | By default only `bodyShape`; values never leave the page context |
| Format | DevTools extension | A versioned format + a published JSON Schema |
| Ranking | None | By weight → proximity → signal type, with `confidence` + `reason` |

In other words: **"diffing two JSON payloads" is no longer novel.** "Diffing an entire
flow, pairing automatically, and capturing structure only" still is.

### `SaintPepsi/openjam` (2★) **[T]**

The open-source version of Jam.dev, describing itself:

> *"🔒 **Nothing is ever uploaded — you have full control over your data.** Everything stays on your machine; the entire bug report is a single local file that only travels if you choose to share it."*
>
> *"...captures console logs, network requests, JS errors, screenshots, device/environment info, a full DOM session replay (rrweb), and opt-in local mic narration onto a single correlated timeline, then exports a **self-contained HTML bug report** — open it offline and watch the session play back."*
>
> *"No backend, no account, no telemetry."*

Consequence: **"local-first, one file, opens offline, no backend, no account" is no
longer a differentiator.** BugCapsule must not present it as if it were its own.

The remaining difference: OpenJam **has no diff**, and it captures **DOM session replay
(rrweb)** — that is, it captures considerably more sensitive data. BugCapsule
deliberately refuses DOM replay. OpenJam's README carries a *"100% AI generated"*
badge; noted neutrally because it shows the idea is "in the air", not in order to
judge it.

---

## 5. What BugCapsule must **not** claim

Written as a list for easy cross-checking when writing the README:

- ❌ "Nobody has built diffing." → Yes they have, `chrome-network-differ`, at field level.
- ❌ "Nobody diffs baseline-vs-broken." → Yes they do, visual regression (1174 repos) and
  API spec diff (`oasdiff` 1364★).
- ❌ "local-first / one file / opens offline / no backend." → OpenJam says exactly the same.
- ❌ "Capture console + network + state." → Ubiquitous: Jam, LogRocket, OpenReplay,
  Bird, Marker.io, Usersnap.
- ❌ "Infers schema from traffic." → `mitmproxy2swagger`, 9608★.
- ❌ "Privacy-first." → Every product in group A claims this.

---

## 6. Proposed claim (withstands the "not found ≠ does not exist" reading)

> BugCapsule captures the **shape** of a broken session, never its values — so two
> runs of the same flow can be **diffed by default**, offline, in a portable file
> that anyone can implement against a versioned JSON Schema.

Three propositions, and the evidence for each:

1. **No documentation of the bug-capture/session-replay group discusses comparing the
   schema/shape of a JSON response.** This cell is empty across all 7 products
   surveyed, even as a manual feature. This is the strongest proposition.
2. **No product automatically compares two captures.** Capture is ubiquitous;
   computing the diff is absent. The only prior art that does field-level diffing
   (`chrome-network-differ`) is manual, network-only, and captures both headers and
   bodies.
3. **Capturing structure by default is the genuinely unique part.** Competitors either
   capture values and then have to redact (Bird records the key-value pairs too; Jam
   and chrome-network-differ record bodies), or capture nothing. Nobody ships a
   **versioned format + JSON Schema** for this — all competitors are UI products or
   standalone scripts.

The third point matters most for the Codex for Open Source goal: a **format** is a
fundamentally different kind of contribution from a product — it is infrastructure for
others to build on, and it is verifiable (`spec/0.1/*.schema.json` + anti-drift tests).

---

## 7. Work not done

- **[?]** Product-level detail for Percy and Chromatic: the doc body could not be read.
  Both attempts failed. Another pass is needed if it is to be cited publicly.
- **[?]** Group A products: only **public** documentation has been surveyed. An
  undocumented beta feature cannot be ruled out.
- **[?]** Not surveyed: Sentry, Datadog RUM, FullStory, Heap, Smartlook, SessionStack,
  Testsigma, QA Wolf, Meticulous, Replay.io.
- **[?]** The Chrome Web Store has not been checked: the real user counts of
  `chrome-network-differ` and of similar extensions. GitHub star counts do not measure
  adoption in the extension world.
- **[?]** The **commercial** side has not been surveyed along the contract-testing line
  (Pact, Schemathesis, Dredd) — there may be conceptual overlap with comparing response
  shape.
