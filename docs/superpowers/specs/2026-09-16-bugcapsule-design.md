# BugCapsule — Design Spec

- **Ngày:** 2026-09-16
- **Trạng thái:** Chờ user review
- **Phiên bản format capsule:** `0.1`

---

## 1. Vấn đề

Bug report frontend thường thiếu context kỹ thuật. QA gửi một câu mô tả kèm screenshot; developer hỏi console, hỏi network request, hỏi state — và thường vẫn không reproduce được.

Các tool hiện có (Jam, OpenReplay, OpenJam, Brie) giải quyết phần "thiếu dữ liệu" bằng cách **thu thập nhiều hơn**: hàng trăm network request, hàng chục console log, session replay, metrics. Vấn đề mới xuất hiện: developer nhận một đống dữ liệu và phải tự trả lời *"trong đống này, cái gì thực sự khác thường?"*

BugCapsule chọn hướng ngược lại.

## 2. Định vị

> **BugCapsule**
> Capture a frontend bug as a portable debugging artifact.
> Compare working and broken sessions to see what changed.
>
> *Stop reproducing. Start diffing.*

Ba trụ:
1. **Portable artifact** — một file `.bugcap` tự chứa, mở được offline, không cần server, không cần account.
2. **Privacy by default** — capture ít thay vì capture hết rồi redact. Mặc định không có gì rời khỏi máy người dùng.
3. **Working ↔ broken diff** — câu hỏi "cái gì đã thay đổi", không phải "cái gì đã xảy ra".

### Non-goals

Không cạnh tranh với session replay. Không làm video, DOM replay, backend, account, cloud sync, Jira integration, AI. Không làm observability platform.

## 3. Quyết định đã chốt

| # | Quyết định | Lựa chọn |
|---|---|---|
| D1 | Cơ chế capture | Toolbar popup + inject sớm (`world:MAIN`, `document_start`). **Không** dùng `chrome.debugger` ở v0.1. |
| D2 | Triết lý redaction | Hai lớp: capture-less-by-default (cấu trúc) + denylist redaction (chỉ trên phần opt-in). Có màn review, nhưng không bắt buộc. |
| D3 | Mô hình permission | `optional_host_permissions` + onboarding chọn domain. Ring buffer chỉ chạy trên domain được allowlist. |
| D4 | Mục tiêu v0.1 | Dogfood trong team trước. Ưu tiên robustness trên app thật (iframe, GraphQL, SSR) hơn polish. |
| D5 | Chủ sở hữu capture pipeline | Service worker sở hữu state; metadata đã redact ghi vào `chrome.storage.session`; body thô ở memory LRU. |

## 4. Kiến trúc

### 4.1 Cấu trúc workspace

```
bugcapsule/
├── apps/
│   ├── extension/          # WXT + React popup
│   │   ├── entrypoints/
│   │   │   ├── background.ts      # SW — owner của state
│   │   │   ├── probe.main.ts      # world:MAIN, document_start — hooks
│   │   │   ├── bridge.isolated.ts # world:ISOLATED — relay + DOM access
│   │   │   └── popup/             # review UI
│   │   └── src/capture/           # capture logic — chưa phải package
│   ├── viewer/             # Preact, build ra single-file HTML
│   └── cli/                # npx bugcapsule open | diff
├── packages/
│   ├── schema/             # zod + JSON Schema + types (không phụ thuộc package nội bộ)
│   ├── capsule/            # redaction engine + read/write .bugcap
│   └── diff/               # normalization + signal classification
├── playground/             # app deterministic: healthy | broken
└── fixtures/               # golden capsule pairs + corpus payload rò rỉ
```

**Năm workspace, không phải bảy.** `packages/capture` và `packages/redaction` không tồn tại ở v0.1: capture chưa có interface ổn định nên đóng gói sớm chỉ tạo ceremony; redaction gộp vào `capsule` để nó là cửa duy nhất.

Mục tiêu "core độc lập với Chrome extension" vẫn đạt — `capture` vốn không thuộc core. Khi interface ổn định (dự kiến v0.2), `capture` được promote thành package mà không consumer nào phải sửa.

### 4.2 Hướng phụ thuộc

`apps → packages`, một chiều, không bao giờ ngược lại. `packages/schema` không phụ thuộc gì.

### 4.3 Interface chịu lực

```ts
// packages/schema — kiểu duy nhất được đi qua biên giới
type Redacted<T> = T & { readonly __redacted: unique symbol }   // branded type

type RawSession      = { /* capture code sản xuất ra cái này */ }
type RedactedSession = Redacted<RawSession>                     // chỉ capsule tạo được

// capture code chỉ thấy cái này — không biết gì về Chrome API
interface CaptureSink {
  push(ev: RawEvent): void
  snapshot(opts: SnapshotOpts): Promise<RawSession>
}

// cửa DUY NHẤT biến Raw -> Redacted
declare function redact(s: RawSession, cfg: RedactConfig): RedactedSession

// pure function -> test cực dễ, không cần browser
declare function diffCapsules(a: Capsule, b: Capsule, cfg: DiffConfig): DiffResult
```

**Ép buộc ở tầng type:** `packages/capsule` chỉ nhận `RedactedSession`. Một dev tương lai thêm đường capture mới mà quên redact sẽ **không compile được**, thay vì trông chờ vào code review.

## 5. Capsule format

`.bugcap` là một zip. JSON dùng deflate; screenshot dùng store (không nén lại ảnh đã nén).

```
manifest.json       ← entry đầu tiên trong zip
environment.json
actions.json
console.json
network.json        ← KHÔNG đặt tên là .har
state.json
screenshot.webp     ← viewport-only, đã annotate
diff.baseline.json  ← chỉ có khi capture kèm baseline
report.md
viewer.html         ← self-contained, data nhúng JSON island
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
  "baseline": { "capsuleId": "01J8...", "capturedAt": "...", "source": "local-auto" },  // hoặc null
  "capture": { "durationMs": 30000, "events": 36, "documents": 2 },
  "redaction": {
    "total": 6,
    "hashMode": "hmac-sha256-prefix8",   // hoặc null
    "saltId": "proj-a1b2",               // KHÔNG chứa salt
    "rules": [{ "id": "auth-header", "count": 3 }]
  },
  "fidelity": { /* bắt buộc — xem 5.8 */ }
}
```

Quy tắc:
- `formatVersion` theo semver. Viewer **từ chối** major lạ, **degrade** (bỏ qua) field lạ ở minor.
- `role` cho phép diff hai capsule bất kỳ và là nền của opportunistic baseline.
- `redaction` chỉ ghi **rule id + count**, không bao giờ ghi value. Vừa đủ cho UI "3 secrets removed", vừa không tự tạo leak mới.
- `saltId` là định danh salt, không phải salt.

### 5.2 `network.json` — một entry

```jsonc
{
  "id": "req-42",
  "docId": "d1", "frameId": 0, "frameUrl": "https://...",
  "seq": 42, "tMono": 6012, "tWall": 1758000000000,
  "method": "GET",
  "url": "https://.../api/permissions",     // query nhạy cảm đã redact
  "pathTemplate": "/api/permissions",
  "templateConfidence": "confirmed",         // confirmed | guessed
  "status": 403, "statusText": "Forbidden", "durationMs": 210,
  "resourceType": "fetch",                   // fetch | xhr
  "requestHeaders": { "accept": "application/json" },  // allowlist, đã redact
  "requestSchema": { "type": "object", "properties": {} },
  "requestBody": null,                       // chỉ khi opt-in
  "responseSchema": { "type": "object", "properties": { "error": {"type":"string"} } },
  "responseBody": null,                      // chỉ khi opt-in
  "bodySkipped": { "reason": "not-opted-in", "bytes": null },
  "redactions": [{ "rule": "auth-header", "count": 1 }]
}
```

`bodySkipped.reason` ∈ `not-opted-in | size | streaming | binary | parse-error`. Mọi lần skip đều được ghi, không im lặng.

### 5.3 `console.json` — một entry

```jsonc
{
  "id": "c-7", "docId": "d1", "frameId": 0, "seq": 7, "tMono": 4210, "tWall": 1758000000000,
  "level": "error",
  "message": "Cannot read properties of undefined",
  "stack": "at PermissionService.ts:81",
  "args": null,                              // opt-in, đã redact
  "source": "page",                          // page | extension | unknown
  "correlatedRequestId": "req-42",
  "correlatedDeltaMs": 12,
  "redactions": []
}
```

`source: "extension"` dùng để lọc noise từ extension khác (`chrome-extension://`) — rác rất phổ biến trong report thật.

### 5.4 `actions.json` — một entry

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
  "value": { "length": 12 },                 // KHÔNG bao giờ chứa value
  "url": null                                // chỉ với navigation
}
```

### 5.5 `state.json`

```jsonc
{
  "localStorage":   { "keys": ["userRole", "feature_new_product"], "values": null },
  "sessionStorage": { "keys": [], "values": null },
  "cookies":        { "count": 3, "names": ["session"] },     // không value
  "snapshot":       null    // kết quả window.__BUGCAPSULE_SNAPSHOT__(), đã redact
}
```

`values` và `snapshot` chỉ có khi opt-in. Việc redaction **vẫn chạy** trên chúng.

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

`build` đáng có: "bug này ở deploy nào" là câu hỏi thường gặp và rẻ để trả lời nếu app expose.

### 5.7 Timeline & nhiều document

`performance.now()` reset về 0 ở mỗi document. Mỗi document có `docId` riêng; event đầu tiên của mỗi document neo `tWall = Date.now()`. Viewer dựng lại trục thời gian bằng cách cộng offset giữa các document. Mọi event mang `{ docId, tMono, tWall, frameId, seq }`.

### 5.8 `fidelity` — bắt buộc

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

Trung thực là feature. Dev thấy `workers: "not-captured"` sẽ không săn ma trong dữ liệu không tồn tại. Không tool nào trong nhóm đối thủ làm việc này.

### 5.9 Quy tắc format

- **Viewer nhúng data vào chính nó** dưới dạng `<script type="application/json" id="capsule">`. Viewer **không bao giờ** `fetch()` file anh em: trên `file://`, origin là `null` và Chrome chặn CORS → viewer trắng trang. Đây là đường đi chính của sản phẩm, không phải edge case.
- Các file JSON riêng vẫn ship để CLI và công cụ ngoài (`jq`) dùng.
- Screenshot là WebP (giảm ~80% so PNG), trừ khi người dùng chọn PNG.
- Viewer nhúng giữ **< 150KB uncompressed** vì nó nằm trong *mọi* capsule được gửi đi.
- CLI giải nén phải chặn **zip-slip** (`../`, absolute path) và **zip-bomb**: cap tổng uncompressed size ở `min(200MB, 100× compressed size)`.

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

`suppressed` luôn có mặt. **Không bao giờ ẩn im lặng.**

## 6. Capture pipeline

### 6.1 Luồng

```
probe.main.ts  (world:MAIN, document_start, all_frames:true)
   │  hook: console.* · window.onerror · unhandledrejection
   │        fetch · XMLHttpRequest
   │        History API (pushState/replaceState/popstate)
   │        click/input/submit/scroll/resize (capture phase)
   │        visibilitychange
   │  mọi event: { docId, tMono, tWall, frameId, seq }
   ▼  postMessage + token
bridge.isolated.ts  (world:ISOLATED)
   ▼  chrome.runtime.sendMessage
background.ts  (SW — owner)
   ├─ redact()   ← CHOKE POINT DUY NHẤT
   ├─ metadata  → chrome.storage.session  (batch 500ms, key cap:{tabId})
   └─ body thô  → memory LRU (1MB/response, 200 event, skip binary/streaming)
   ▼  khi user bấm Capture
capsule.write() → .bugcap → chrome.downloads
```

**Handshake bridge:** `bridge.isolated.ts` sinh một nonce ngẫu nhiên mỗi document, tạo `MessageChannel`, gửi `port2` cho MAIN world qua `window.postMessage(..., location.origin)` với marker `__BUGCAPSULE__`. `probe.main.ts` chỉ chấp nhận message đầu tiên khớp marker + nonce, rồi chuyển sang dùng port. Page script chạy ở `document_start` cùng thời điểm nên tồn tại cửa sổ race nhỏ — đã ghi nhận ở §6.6.

### 6.2 Vì sao buffer nằm ở SW

Service worker MV3 bị kill khi idle. Buffer 30 giây nằm trong memory SW sẽ mất bất cứ lúc nào — tệ nhất là đúng lúc tester quay lại bấm Capture.

`chrome.storage.session` sống qua cả SW death lẫn navigation. Vì buffer **chỉ chứa metadata đã redact + JSON schema** (không body), 100 request chỉ tốn vài chục KB — thừa quota. Đây là chỗ quyết định capture-less-by-default trả cổ tức về mặt kỹ thuật.

Body thô ở memory SW với LRU + size cap. Nếu SW restart, body mất → `fidelity.swRestarted: true`. **Không im lặng mất dữ liệu.**

SW được giữ ấm bằng keepalive nhẹ **chỉ trong lúc capture đang bật**, không phải thường trực.

**Chính sách buffer:** cửa sổ capture = **30 giây gần nhất**, đồng thời cap theo số lượng: **500 event tổng**, **200 network**, **200 console**, **100 action** — ngưỡng nào chạm trước thì evict FIFO theo đó. Event cũ hơn cửa sổ 30s bị bỏ trước khi xét cap số lượng. Đây là con số khởi điểm; tinh chỉnh sau khi có số đo thực từ playground.

### 6.3 Yêu cầu với hook

- Mọi hook bọc `try/catch`. **Không bao giờ** throw vào code của app.
- Giữ nguyên `this`; giữ `Function.prototype.toString` trông tự nhiên (một số thư viện kiểm tra).
- Xử lý cả `fetch(Request)` và `fetch(url, init)`.
- Hook throw → fallback về native + ghi event `captureError`.
- `response.clone()` **trước khi** trả response cho app; không bao giờ consume bản gốc.
- Skip theo `content-type` không phải JSON/text; skip nếu `content-length > 1MB`.
- SSE / streaming: `tee()` + timeout, không đọc đến hết (treo).

### 6.4 iframe

`all_frames: true` để inject vào cả cross-origin frame. Mỗi event mang `frameId` + `frameUrl`. Số frame inject được ghi vào `fidelity.frames`.

### 6.5 Out of scope có khai báo

Web Worker, Service Worker của app, WebSocket frames, SSE bodies. Ghi vào `fidelity`, không cố capture.

### 6.6 Giới hạn bảo mật đã biết

Bridge `postMessage` **không phải ranh giới bảo mật**. Page script về lý thuyết có thể giả hoặc đọc event telemetry trong cửa sổ race nhỏ ở `document_start`. Threat model: "trang web bơm rác vào capsule local của chính nó" — chấp nhận được, **nhưng phải ghi rõ trong README và không được quảng cáo bridge này là an toàn.**

## 7. Redaction engine

### 7.1 Lớp 1 — cấu trúc (capture-less-by-default)

`RawSession` **không bao giờ chứa** những thứ này. Đây không phải "chứa rồi xoá".

| Dữ liệu | Mặc định |
|---|---|
| URL, method, status, duration, `frameId` | ✅ |
| JSON **schema** (shape) của request/response | ✅ |
| `localStorage` / `sessionStorage` **keys** | ✅ |
| Console `error` / `warn` | ✅ |
| Console `log` / `info` / `debug` | ⚠️ opt-in |
| Request body · Response body · storage **values** | ⚠️ opt-in |
| `Authorization` · `Cookie` · `Set-Cookie` | ❌ không bao giờ |
| Value của `input` / `textarea` / `contenteditable` | ❌ không bao giờ (chỉ `length`) |
| Body khi > 1MB, binary, streaming | ❌ skip + ghi `bodySkipped` |

### 7.2 Lớp 2 — redaction tại choke point

Chạy trong SW, ngay khi event vào buffer, trên mọi thứ đã lọt vào: opt-in bodies, storage values, console text, URL.

```ts
interface RedactRule {
  id: string
  where: 'header' | 'query' | 'jsonPath' | 'formField' | 'storageValue' | 'urlPath' | 'consoleText'
  pattern: RegExp | string[]
  action: 'remove' | 'mask' | 'hash'
  optInOnly?: boolean
}
```

**Denylist mặc định:**

- **Headers:** `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key`, `x-auth-token`, `x-csrf-token`.
- **Query:** `token`, `access_token`, `id_token`, `api_key`, `apikey`, `secret`, `password`, `pwd`, `session`, `sid`, `jwt`, `signature`, `x-amz-signature`, `x-amz-credential`, `code` (OAuth).
- **Tên field** (bỏ `_`/`-`, lowercase): `password|passwd|pwd|secret|token|apikey|accesstoken|refreshtoken|sessionid|csrf|nonce|otp|mfa|pin|cvv|cvc|cardnumber|pan|ssn|privatekey|clientsecret|credential`. **Đệ quy** vào object lồng nhau và array — đây là chỗ GraphQL (`variables.input.password`) và multipart/form-urlencoded hay lọt.
- **Hình dạng value:** JWT `^eyJ...\.eyJ...\.`, prefix `Bearer`/`Basic`, PEM `-----BEGIN ... PRIVATE KEY-----`, `AKIA[0-9A-Z]{16}`.

**Ba leak path dễ quên:**

1. **Console text** — `console.log('Bearer abc')`, `console.log(localStorage)`, `console.log(response)`. Redaction phải quét cả string của console, không chỉ network.
2. **URL path** — secret trong path (`/reset/eyJhbGci...`) không nằm ở query. Phải quét cả path segment.
3. **`input` value** — không chỉ `type=password`. OTP, số thẻ, CMND đều là `type=text`.

### 7.3 Entropy chỉ áp dụng theo ngữ cảnh

**Không** redact theo entropy toàn cục. `etag`, content-hash, SRI `integrity`, cache key đều entropy cao; redact hết sẽ phá giá trị debug. Entropy chỉ áp dụng **trong ngữ cảnh bí mật**: value nằm dưới key khớp denylist, hoặc nằm trong header.

### 7.4 Fail-closed

Nếu redactor throw hoặc không parse được body → **bỏ body**, không pass nguyên trạng. Fail-open ở đây là tự sát.

### 7.5 Hash mode

`Authorization: Bearer <redacted:7d4a1c93>` cho phép diff phát hiện **"token đã đổi giữa baseline và broken"** — cực liên quan cho bug auth — mà không lộ token.

**Salt nằm trong config của extension (per-project), KHÔNG nằm trong capsule.** Nếu salt nằm trong capsule thì nó công khai, và secret entropy thấp (PIN 4 số, OTP 6 số) brute-force được → hoá ra lại leak. Với salt trong config:

- Capsule chỉ chứa hash prefix → người có file không brute-force được.
- So sánh cross-capsule vẫn chạy **nếu hai máy dùng cùng project salt** (team chia sẻ salt một lần, ngoài băng).
- Manifest ghi `hashMode` + `saltId`, không ghi salt.

Đây là cơ chế so sánh **equality-only**, không phải "ẩn an toàn tuyệt đối".

## 8. Diff engine

`packages/diff` là **pure function** — đây là lý do nó được build trước extension.

```
normalize(A), normalize(B) → match → classify → rank → render
```

### 8.1 Normalization

**Segment ID không cần đoán.** Nếu **trong cùng một capsule** thấy `/api/users/2181` *và* `/api/users/7328`, thì `/api/users/:id` là **xác nhận** (`templateConfidence: "confirmed"`). Nếu chỉ thấy một lần, đó là **suy đoán** (`"guessed"`) — và report phải hiện URL gốc để dev kiểm chứng. Hai mức confidence khác nhau, không gộp.

- Heuristic ID: segment số thuần, UUID, hex ≥ 8, ULID, nanoid, base64url dài.
- **Query:** sort key; drop volatile (config + heuristic: key khớp `t|ts|timestamp|cache|cb|nonce|requestId|traceId|correlationId|sessionId`, hoặc value khớp `^\d{10,13}$` (epoch giây/ms) hay UUID); **hiện số đã bỏ**.
- **Array:** so sánh **order-insensitive theo identity key** (`id`) nếu có, fallback theo index. Không làm thì một array 50 sản phẩm bị reorder sẽ tạo 50 diff rác. Nếu chỉ đổi thứ tự → báo `ordering`, không báo content.
- **Volatile leaf:** `timestamp|requestId|traceId|csrf|nonce|uuid|createdAt|updatedAt|etag` — configurable per project.
- **Ignore-list per-project và user-extensible.** Mỗi codebase có field volatile riêng.

### 8.2 Matching

Key `(method, pathTemplate)`. Nhiều occurrence → ghép theo thứ tự; số lượng lệch → presence/absence signal. Body-similarity pairing để v0.2.

### 8.3 Signal classes

| Class | Default view | Ghi chú |
|---|---|---|
| `type-change` (`1 → "1"`) | 🔴 hiện | |
| `nullability-change` (`string[] → null`) | 🔴 hiện | |
| `presence-change` | 🔴 hiện | |
| `schema-shape-change` | 🔴 hiện | |
| `status-class-change` (`2xx → 4xx`) | 🔴 hiện | |
| `request-only-in-broken` | 🔴 hiện | |
| `request-only-in-baseline` | 🔴 hiện | call lẽ ra phải xảy ra mà không xảy ra |
| `ordering-change` | 🟠 hiện | race auth: `GET /permissions` trước khi `POST /login` xong |
| `duration-outlier` | 🟠 hiện | `after > 3× before` **và** `after > before + 300ms` |
| `value-drift` (cùng type, khác value) | ⚪ **ẩn** mặc định | `"khai" → "minh"` |
| `volatile` | ⚫ bỏ hẳn + đếm | |

Đây là phần làm nên sản phẩm. Diff ngây thơ hiển thị `username: "khai" → "minh"` ngang hàng với `quantity: 1 → "1"` sẽ khiến dev cuộn qua và bỏ lỡ cái quan trọng — đúng vấn đề "127 network requests" mà BugCapsule đang cố giải.

### 8.4 Ranking

Weight desc, rồi theo **khoảng cách thời gian tới anomaly đầu tiên** (console error đầu tiên hoặc 4xx/5xx đầu tiên, lấy cái nào sớm hơn). Thứ gần nhất khả năng cao là nguyên nhân. Deterministic, không AI.

`proximityMs` = khoảng cách từ event liên quan tới anomaly đầu tiên; **âm** nếu event xảy ra trước anomaly.

### 8.5 Trust budget

Rủi ro số 1 của dự án: false-positive bào mòn trust. Hai session **không bao giờ** giống nhau; diff là heuristic và **sẽ** sai. Sản phẩm phải chịu được điều đó.

- Mỗi dòng diff có `confidence` + **lý do một câu** ("cùng type, khác value").
- Dismiss → lưu per-project vào `chrome.storage.local`, scoped theo `origin + pathTemplate`. **Không** lưu vào capsule (capsule phải portable).
- Viewer **luôn hiện** *"7 diff bị ẩn bởi ignore rules của project"* + nút unhide.
- Deterministic: cùng input → cùng output byte-for-byte. Không timestamp trong output. Sort stable.

## 9. Baseline strategy

### 9.1 Định nghĩa

**Healthy session:** 0 console error, 0 request status ≥ 400, ≥ 1 user action, duration ≥ 1000ms.

### 9.2 Lưu trữ

`chrome.storage.local`, scoped `origin + pathTemplate`, dạng **reduced baseline** (không screenshot, không body — chỉ metadata + schema), TTL 24h, tối đa 3 per origin.

**Tradeoff privacy:** opportunistic baseline nghĩa là extension **giữ lại dữ liệu session đã redact qua khỏi phiên làm việc**, mặc định. Nó local, đã redact, có TTL, và xoá được — nhưng nó *là* retention. Quyết định: **mặc định BẬT, chỉ trên domain đã allowlist, có toggle rõ ràng, popup hiện "BugCapsule đang giữ 2 baseline trên máy này" + nút xoá.**

### 9.3 Hệ quả từ module boundaries

Dev mở `viewer.html` từ `file://` — **viewer không có quyền truy cập `chrome.storage`**. Viewer **không thể** đọc baseline local. Do đó:

1. **Extension tính diff với baseline tốt nhất ngay lúc capture và nhúng kết quả vào capsule** (`diff.baseline.json` + một mục trong `report.md`). Dev mở là thấy diff ngay, capsule vẫn self-contained. **Đây là đường chính.**
2. Viewer vẫn hỗ trợ **kéo-thả capsule thứ hai** → diff tính client-side bằng chính `packages/diff` compile vào viewer. Không server, offline hoàn toàn.
3. Capsule ghi `baseline: { capsuleId, capturedAt, source: 'local-auto' | 'user-provided' }`.

Nếu không có baseline local → viewer hiện *"Chưa có baseline. Kéo capsule 'working' vào đây, hoặc tự capture một cái."*

### 9.4 API phía app: `window.__BUGCAPSULE_SNAPSHOT__`

State thật gây bug nằm trong React/Redux/Vue store, **không** nằm trong localStorage. App tự khai báo:

```js
window.__BUGCAPSULE_SNAPSHOT__ = () => ({
  cartVersion: store.cart.version,
  featureFlags: flags.active,
});
```

Được: deterministic, privacy-safe by design (app author kiểm soát cái gì lộ), không cần DOM replay, không cần AI, và state diff trở nên **thật** thay vì đoán mò. Chi phí: ~30 dòng trong extension + một đoạn README.

## 10. Viewer

Ràng buộc cứng: **chạy offline từ `file://`, zero network.**

- Single HTML; data nhúng JSON island. **Preact + `fflate` là hai dependency duy nhất.** Không Tailwind runtime, không chart lib, không component lib.
- **Capsule nhập vào là untrusted input.** `console.message`, URL, body string đều do trang web kiểm soát → XSS vào viewer là có thật. Bắt buộc: `textContent` cho mọi thứ, không `innerHTML`, không `dangerouslySetInnerHTML`, CSP meta tag.
- Ba chế độ: single capsule · diff hai capsule (kéo-thả) · diff nhúng sẵn.
- Thứ tự section: `Issue` → `Detected anomaly` (đã rank) → `Environment diff` → `State diff` → `Console` (grouped + correlate) → `Network` (chỉ anomaly mở sẵn) → `Actions` + screenshot annotate → `Fidelity` + `Redaction report`.
- Screenshot có **marker đánh số** theo action; click marker → nhảy tới action. Anchor `#network-ordering` trong URL hash để dev gửi link trong `file://`.
- Nút unhide cho diff bị ignore rule ẩn.

**Blur tool KHÔNG nằm ở viewer.** Nếu ảnh gốc đã nằm trong file thì blur sau là diễn trò — dữ liệu đã bay đi. Blur thuộc về **bước review trong popup, trước khi Export**. Viewer chỉ hiển thị ảnh đã annotate.

**Anti-requirement:** hosted viewer ở `bugcapsule.dev` **không thuộc v0.1**. Nó là cám dỗ để gắn analytics, mâu thuẫn trực tiếp với positioning, và chia đôi sự tập trung. Viewer nhúng trong capsule **chính là** sản phẩm.

## 11. Test strategy

### 11.1 Thứ tự build

```
1. packages/schema          (zod + types)
2. fixtures/                (capsule cặp cho mọi signal class + corpus payload rò rỉ)
3. packages/diff + tests    ← pure, KHÔNG cần Chrome
4. packages/capsule + tests (redaction corpus + zip io)
5. playground/              (app deterministic 2 chế độ)
6. apps/extension           (capture pipeline đập vào playground)
7. apps/viewer              (đọc fixtures trước, capsule thật sau)
8. apps/cli
```

Bước 1–4 cho ~60% sản phẩm **không cần chạm một dòng Chrome API nào**. Diff engine và redaction engine là pure function — phát triển và test nhanh gấp nhiều lần so với debug qua extension reload.

### 11.2 `playground/`

App deterministic, `?mode=healthy` và `?mode=broken`, chạy trên HTTP server nhỏ (middleware của Vite) để `fetch`/XHR **thật** sự chạy qua hook.

| Route | healthy | broken |
|---|---|---|
| `POST /login` | 200 | 200 |
| `GET /profile` | 200 | 200 |
| `GET /permissions` | `{permissions: string[]}` | **403** `{error, code:"TOKEN_EXPIRED"}` |
| `POST /api/order` | 201 | 400 `quantity must be a number` |
| `/crash` | — | JS `TypeError` |
| localStorage | `new_auth=false` | `new_auth=true` |
| `__BUGCAPSULE_SNAPSHOT__` | `cartVersion: 2` | `cartVersion: 3` |
| `/embed` | iframe | iframe (test `frameId`) |
| `/big` | 2MB response | test size cap |
| `/leak` | JWT trong header + body + `console.log` | test redaction |
| `/stream` | SSE | test streaming skip |
| `/noisy` | 60 log hỗn hợp (log/info/warn/error) + noise giả lập từ extension khác | test console grouping + correlation |
| `?delay=` | inject latency | test `duration-outlier` |

Nó là demo, là fixture generator, và là trang QA thủ công — một thứ ba việc.

### 11.3 Bốn tầng test

1. **Unit** — normalization (bảng ID heuristic), classification, redaction rules (corpus-driven), zip round-trip, schema validation.
2. **Golden** — output diff cho từng fixture pair, snapshot test. Diff là pure nên đây là cách rẻ nhất để bảo vệ hành vi và tài liệu hoá output mong đợi.
3. **Integration (Playwright + persistent context)** — giữ hẹp: (a) extension load được, (b) capture playground ra capsule với số event đúng, (c) canary rò rỉ. MV3 SW testing sẽ flaky — đẩy logic xuống unit level.
4. **Security** — zip-slip + zip-bomb trên CLI.

### 11.4 Canary rò rỉ

Plant secret biết trước vào playground (`Authorization: Bearer SUPERSECRET_CANARY_12345`, một field `password`, một JWT trong localStorage), capture thật, rồi **assert chuỗi đó không xuất hiện ở bất kỳ byte nào của zip** (đọc raw bytes, cả JSON lẫn WebP).

Đây là bài test duy nhất mà nếu fail, sản phẩm mất quyền tồn tại. **Viết nó trước khi viết redaction engine.**

Thêm **diff determinism test**: chạy hai lần, assert output byte-identical (bắt timestamp lọt vào output).

## 12. Scope v0.1

### Trong scope

Capture (URL/env, screenshot annotate + blur pre-export, console errors, failed fetch/XHR, actions, ring buffer 30s) · redaction 2 lớp + hash mode · `.bugcap` export/import · viewer offline · compare 2 capsule · state diff (storage + snapshot hook) · API schema diff · opportunistic baseline · fidelity manifest · diff signal classes · CLI `open`/`diff`.

### Ngoài scope (ghi trong README)

Video · DOM replay · backend · account · cloud sync · Jira · AI · WebSocket/SSE **bodies** · Web Worker capture · hosted viewer · HAR export · body-similarity matching · entropy redaction toàn cục · Firefox/Safari · MV2 · UI quản lý salt đa người dùng.

### Milestones

| Mốc | Nội dung | Demo được gì |
|---|---|---|
| **M1** | schema + fixtures + diff + capsule (bước 1–4 §11.1) | `bugcapsule diff a.bugcap b.bugcap` trên capsule viết tay — **killer feature đã chứng minh, chưa cần browser** |
| **M2** | playground + extension capture + redaction | capture thật từ Chrome, canary test xanh |
| **M3** | viewer + annotate + blur | dev mở file, thấy diff + ảnh |
| **M4** | baseline + CLI + snapshot hook + rollout nội bộ | tester bấm một nút, dev nhận diff sẵn |

**Mỗi mốc là một implementation plan riêng.** Plan đầu tiên target M1. Không viết một plan khổng lồ cho cả bốn mốc — interface của M2–M4 sẽ đổi sau khi M1 cho thấy diff engine thực sự hoạt động ra sao.

Nếu hết thời gian sau M2, vẫn có artifact + diff engine thật, chỉ thiếu UI — chứ không phải một extension nửa vời không chứng minh được gì.

## 13. Rủi ro

| # | Rủi ro | Mức |
|---|---|---|
| 1 | False-positive diff bào mòn trust → dev ngừng mở capsule | 🔴 Cao nhất |
| 2 | Enterprise policy chặn sideload → phải Web Store unlisted + chờ review | 🔴 |
| 3 | App thật đa dạng hơn playground (GraphQL, micro-frontend, SSR hydration) phá giả định capture | 🟠 |
| 4 | `storage.session` quota + offscreen lifetime chưa verify | 🟠 |
| 5 | Tính mới của diff chưa verify (web search không khả dụng trong session này) | 🟠 ảnh hưởng định vị |
| 6 | Bridge `postMessage` không phải ranh giới bảo mật | 🟡 |
| 7 | `.bugcap` bị email corporate chặn | 🟡 |
| 8 | Baseline = retention mặc định | 🟡 |
| 9 | Playwright + MV3 SW flaky | 🟡 |

## 14. Câu hỏi mở cần verify trước khi code

Không claim nào dưới đây được verify trong session này (web search không khả dụng; `web_fetch` vào docs Chrome chỉ trả về thanh điều hướng). Cần xác nhận trước M2:

| Claim | Ảnh hưởng | Nguồn cần kiểm |
|---|---|---|
| `chrome.webRequest` không đọc được response body | Quyết định §6 (hook là nguồn duy nhất cho body) | developer.chrome.com/docs/extensions/reference/api/webRequest |
| `chrome.storage.session` quota ~10MB; `unlimitedStorage` không áp dụng | §6.2 | developer.chrome.com/docs/extensions/reference/api/storage |
| `world: "MAIN"` khả dụng cho content script đăng ký trong manifest | §6.1 | developer.chrome.com/docs/extensions/develop/concepts/content-scripts |
| `chrome.tabs.captureVisibleTab` giới hạn 2 lần/giây; chỉ viewport | §10 | developer.chrome.com/docs/extensions/reference/api/tabs |
| `debugger` không khai báo được là optional permission | §3 D1 | developer.chrome.com/docs/extensions/reference/api/debugger |
| `optional_host_permissions` + onboarding pattern | §3 D3 | developer.chrome.com/docs/extensions/reference/api/permissions |
| Offscreen document có bị Chrome tự đóng sau idle | §6.2 (phương án B đã loại) | developer.chrome.com/docs/extensions/reference/api/offscreen |
| OpenJam / Jam / Brie có diff working-vs-broken không | §2 định vị | jam.dev, repo OpenJam, brie |
| WXT vs CRXJS: version + hỗ trợ `world: MAIN`, offscreen, multi-entry | §4.1 | wxt.dev |
| Playwright hỗ trợ test extension MV3 | §11.3 | playwright.dev/docs/chrome-extensions |
| Chrome Web Store review với host permission rộng | §13 #2 | developer.chrome.com/docs/webstore |

## 15. Tiêu chí thành công v0.1

1. Tester bấm một nút, file `.bugcap` được tải, **không có gì rời khỏi máy**.
2. Canary test xanh: không byte nào của secret đã plant xuất hiện trong artifact.
3. Developer mở `viewer.html` bằng double-click, thấy diff đã rank trong **< 5 giây**, không cần cài gì.
4. Trên route `/noisy` của playground (60+ log): grouping + correlation giảm còn ≤ 3 dòng signal.
5. Trong một bug thật của team: dev nói được "à, đây rồi" mà không cần hỏi QA thêm câu nào.
6. Ít nhất một bug thật được fix mà không cần repro thủ công.
