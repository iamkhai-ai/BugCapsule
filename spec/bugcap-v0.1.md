# BugCapsule Format Specification v0.1

- **Trạng thái:** Frozen cho v0.1
- **`formatVersion`:** `0.1.0`
- **Ngày:** 2026-09-16

> **Quy tắc quan trọng nhất của tài liệu này: format là vĩnh viễn.**
> Một capsule đã được capture không thể nhận thêm field. Mọi thứ cần cho việc
> đọc, diff và điều tra trong nhiều năm tới phải có mặt trong v0.1 **ngay bây
> giờ**, kể cả khi thuật toán dùng nó chỉ xuất hiện ở phiên bản sau.
> Đây là lý do v0.1 mang `docId`, `frameId`, `seq`, `role` và `bodyShape`.

Các từ khoá **MUST**, **MUST NOT**, **SHOULD**, **MAY** được hiểu theo RFC 2119.

---

## 0. Nguồn sự thật

JSON Schema trong `spec/0.1/*.schema.json` **được sinh tự động** từ
`packages/format/src/*.ts` (zod 4). Sửa schema bằng cách sửa zod rồi chạy
`pnpm gen:schemas`; có test chống drift nên sửa tay sẽ làm test đỏ.

Hệ quả: TypeScript types, validator và contract công bố cho third party không
thể lệch nhau, vì cả ba đọc từ một định nghĩa.

Một ngoại lệ có chủ ý: **JSON Schema công bố nới `additionalProperties` thành
`true`**. `z.object()` mặc định phát `false`, nhưng §12 bắt reader bỏ qua field
không nhận biết — nếu không nới thì chính contract tự phá forward
compatibility. Việc kiểm tra chặt là nghĩa vụ của **producer**, không phải của
contract.

---

## 1. Mục tiêu và phi mục tiêu

**Trong v0.1:** một artifact để bàn giao khi có bug frontend — không server,
không account, không tracking; tự chứa; mở được offline; và **diff được** giữa
phiên chạy được và phiên hỏng.

**Ngoài v0.1** (không được thêm vào format ở v0.1): video, DOM replay, AI,
cloud/backend, tích hợp Jira/Linear, HTTP response body bắt buộc, normalize
path template.

---

## 2. Đơn vị đóng gói

`.bugcap` là một file **ZIP**. Tên entry là một phần của format và MUST NOT đổi
trong cùng MAJOR:

| Entry | Nội dung |
|---|---|
| `manifest.json` | Bắt buộc |
| `environment.json` | Tuỳ chọn |
| `actions.json` | Tuỳ chọn |
| `network.json` | Tuỳ chọn |
| `console.json` | Tuỳ chọn |
| `state.json` | Tuỳ chọn |
| `privacy.json` | Tuỳ chọn |
| `assets/screenshot.png` | Tuỳ chọn |

JSON SHOULD được deflate. `assets/screenshot.png` SHOULD được **store**
(không nén) vì PNG đã nén sẵn — nén lại chỉ làm file to thêm.

`manifest.files` ánh xạ tên logic sang đường dẫn entry. Reader MUST NOT tin
`files`; nó MUST đọc entry thật có mặt.

---

## 3. Kiểu nền

- **Timestamp:** ISO 8601 UTC, MUST kết thúc bằng `Z`. Không lưu offset cục bộ.
- **`formatVersion`:** semver đầy đủ `MAJOR.MINOR.PATCH`.
- **`UrlRef`:** `{ origin, pathname, query }`, trong đó `query` là
  `Record<string, string>`.
  - Value của key **không** nhạy cảm MUST được giữ (`?tab=settings` là tín hiệu
    diff có giá trị).
  - Value của key nhạy cảm MUST được thay bằng `"<redacted>"`.
  - `?tab=settings` và `?token=SECRET` MUST NOT bị đối xử giống nhau: bỏ hết
    value để bảo vệ một số ít là đánh mất phần lớn tín hiệu.
- **`EventBase`** — mọi event trong capsule MUST có:
  - `id` — định danh trong capsule.
  - `docId` — document chứa event. **Bắt buộc**, vì sau hard navigation
    `performance.now()` reset và `offsetMs` của document cũ và mới không tách
    được nếu thiếu nó.
  - `frameId` — `0` là top frame. **Bắt buộc**, nếu không thì không biết một
    console error đến từ iframe nào.
  - `offsetMs` — mili giây kể từ `manifest.capture.startedAt`.
  - `seq` — số tăng đơn điệu, phá thế hoà khi trùng `offsetMs`.

---

## 4. `manifest.json`

Bắt buộc: `format` (`"bugcapsule"`), `formatVersion`, `id`, `createdAt`,
`source`, `capture`.

Tuỳ chọn:
- `role`: `"working" | "broken" | "unknown"`. Thiếu MUST được đọc là
  `"unknown"`. Field này tồn tại vì compare mode cần biết capsule nào là gì —
  không có nó thì không dựng được hai cột Working/Broken.
- `page`: `UrlRef` của trang.
- `files`: bản đồ entry.
- `captureGaps`: mảng mã ngắn khai báo **khoảng trống đã biết** của phiên
  capture (`"workers-not-captured"`, `"missed-before-inject"`,
  `"sw-restarted"`, ...). Khai báo trung thực để consumer không đi săn dữ liệu
  không tồn tại.

`capture`: `{ startedAt, endedAt, durationMs }`.

---

## 5. `privacy.json`

```
policy:  queryValues requestBodies responseBodies bodyShapes storageValues consoleVerbose
redaction: { applied, byRule[], removedFields{headers,queryKeys,bodyPaths,storageKeys} }
```

**`privacy.json` là một lời tuyên bố được kiểm chứng, không phải một lời hứa.**
Nếu `policy` nói một loại dữ liệu không được capture mà dữ liệu đó vẫn có mặt
trong capsule, capsule **không hợp lệ** (`privacy-claim-violated`). Producer
không thể khai một đằng làm một nẻo.

`removedFields` ghi **tên** của field đã bị loại bỏ, **không bao giờ ghi
value**. Tên header và tên query key không phải secret, và "header
`authorization` có được gửi không" là câu hỏi debug thật. Chỉ đếm số lượng mà
không nêu tên là không đủ.

`policy` MUST khai đủ mọi field; không có default ngầm. Nếu `requestBodies` là
`false`, consumer MUST hiểu là body **chưa bao giờ được đọc**, khác hẳn với
"đã đọc rồi xoá".

---

## 6. `environment.json`

`browser`, `os`, `viewport`, `locale`, `timezone`, `network.online`,
`document.visibilityState`, `build`.

Cố ý **không** fingerprint thiết bị: không GPU, không danh sách font, không
hardware ID, không IP. Những thứ đó không cần cho việc reproduce và biến
capsule thành dấu vết nhận dạng.

`build` rất rẻ và trả lời câu hỏi "bug này ở deploy nào".

---

## 7. `actions.json`

Mỗi event: `type` (`click | input | change | submit | navigation | keydown`),
`target` (`tag`, `selector`, `strategy`, `role?`, `inputType?`), `url?`
(navigation), `metadata` (`valueCaptured`, `valueLength?`).

`strategy` theo thứ tự tin cậy giảm dần: `testid`, `id`, `aria`,
`stable-attribute`, `structural`. `structural` phụ thuộc layout và SHOULD được
hiển thị với độ tin cậy thấp.

**Invariant:** nếu `target.inputType === "password"` thì
`metadata.valueCaptured` MUST là `false`. Không có override.

---

## 8. `network.json`

Chỉ `fetch` và `xhr`. `chrome.webRequest` không đọc được response body, nên
monkey-patching là nguồn duy nhất — vì vậy format dùng `network.json` và
**không bao giờ** là `.har`.

Mỗi request: `method`, `url` (`UrlRef`), `resourceType`, `status`,
`durationMs`, `request`, `response`. Mỗi phía là một `CapturedBody`:

- `contentType?`
- `bodyCaptured` — bắt buộc, không được để mơ hồ.
- `body?` — `{ type: "json"|"text", value }`.
- `bodyShape?` — cây type, **mặc định được capture** (§11).
- `omissionReason?` — `disabled | sensitive | unsupported | size-limit |
  capture-failed`. `disabled` nghĩa là chưa bao giờ đọc.

**Invariant:** `bodyCaptured === false` thì `body` MUST NOT có mặt.

---

## 9. `console.json`

Mỗi entry: `level` (`error | warn | info | debug | log`), `message`, `stack?`,
`args?` (mảng **chuỗi** đã được producer serialize kèm depth-limit,
size-limit, cycle-safe và redaction), `source` (`page | extension | unknown`).

`source` tồn tại để lọc noise từ extension khác — rác rất phổ biến trong bug
report thật và thường bị nhầm là lỗi của app.

---

## 10. `state.json`

- `localStorage`, `sessionStorage`: mảng `{ key, valueCaptured, value?,
  valueType? }`.
- `cookieNames`: mảng **tên** cookie.

Value cookie MUST NOT được lưu, và `Set-Cookie` nằm trong hard-deny list.
Nhưng **tên** cookie được giữ, vì bug auth phổ biến nhất là "session cookie
không được set" — đó là thay đổi về *sự hiện diện của key*, không phải value.
Bỏ tên cookie trong khi giữ key localStorage là bất nhất.

`valueType` **chỉ là type**, không phải value — cùng nguyên tắc với
`bodyShape`, nó cho phép phát hiện `boolean → string` mà không cần đọc value.

---

## 11. `bodyShape` — ngôn ngữ shape

```
shape := { "type": "object", "properties": { <key>: shape } }
       | { "type": "array", "items": shape }
       | { "type": "string" | "number" | "boolean" | "null" | "unknown" }
       | { "anyOf": [ shape, ... ] }        // ít nhất 1 phần tử
```

Shape được suy ra **trong page context**. Chỉ shape đi qua bridge; value không
bao giờ rời page context.

**Vì sao mặc định bật.** Hầu hết tín hiệu diff có giá trị — `type-change`,
`nullability-change`, `presence-change`, `schema-shape-change` — suy ra được từ
*cấu trúc*, không cần value. Bật `bodyShape` mặc định nghĩa là diff chạy được
với privacy mặc định, và privacy **mạnh hơn** opt-in body capture vì value
không đi đâu cả.

Quy tắc hợp nhất nhiều shape thành một:

- Object: **merge key** (union các key, đệ quy từng key), MUST NOT gộp thành
  `anyOf` — một array phần tử mà mỗi phần tử thiếu một key khác nhau là chuyện
  bình thường, biến nó thành union sẽ tạo ra `schema-shape-change` giả.
- Array: hợp nhất `items`.
- Còn lại: khử trùng theo khoá canonical rồi sắp xếp; nhiều hơn một thì
  `anyOf`.

Phạm vi v0.1 chỉ là cây type tối giản. Optionality, format, union học từ mẫu,
ràng buộc số học là **advanced inference**, nằm ngoài v0.1.

---

## 12. Hợp đồng tương thích

Đây là contract test được, không phải "best effort":

| Trường hợp | Hành vi reader |
|---|---|
| `MAJOR` khác | **Từ chối** kèm lý do. Reader MUST NOT đoán ngược. |
| Cùng `MAJOR`, `MINOR` cao hơn | **Đọc được**, kèm cảnh báo. Field không nhận biết MUST bị bỏ qua. |
| Cùng `MAJOR`, `MINOR` thấp hơn hoặc bằng | Đọc bình thường. |
| `PATCH` | Bỏ qua. |
| Version hỏng | Từ chối kèm lý do; MUST NOT throw ra ngoài API. |

`MINOR` chỉ được **thêm field tuỳ chọn**. Nó MUST NOT đổi nghĩa của field đã
có. `MAJOR` mới được phép breaking change.

Reader MUST NOT lỗi khi gặp field lạ. Producer SHOULD lỗi khi gặp field lạ
(chế độ strict) để bắt typo ngay lúc tạo capsule.

---

## 13. Invariant mà JSON Schema không diễn đạt được

Schema giữ *cấu trúc*; validator giữ *invariant*. Đây là lý do schema không
dùng `refine()`: ràng buộc kiểu này sẽ vô hình trong JSON Schema công bố.

| Mã | Điều kiện |
|---|---|
| `capture-window-invalid` | `endedAt` MUST NOT trước `startedAt` |
| `body-present-but-not-captured` | `bodyCaptured === false` ⇒ không có `body` |
| `password-value-captured` | `inputType === "password"` ⇒ `valueCaptured === false` |
| `privacy-claim-violated` | `policy` nói không capture ⇒ dữ liệu đó MUST NOT có mặt |
| `unsupported-format-version` | `MAJOR` không hỗ trợ |
| `unknown-field` | Chỉ ở chế độ `strict` của producer |

---

## 14. Yêu cầu an toàn khi đọc

**Một capsule là untrusted input.** Nó đến từ người khác qua chat hoặc email.
Reader MUST:

1. Từ chối entry có đường dẫn tuyệt đối, bắt đầu bằng `\`, chứa `\`, có tiền
   tố ổ đĩa (`C:`), chứa ký tự điều khiển, hoặc chứa segment `..`
   (`unsafe-entry-path`).
2. Kiểm tra **tổng dung lượng sau khi giải nén** từ central directory
   **trước khi giải nén byte nào** (`capsule-too-large`). Đây là thứ làm giới
   hạn zip bomb có thật chứ không phải trang trí.
3. Bỏ qua entry không thuộc danh sách §2 kèm cảnh báo — **không** coi là lỗi,
   vì MINOR tương lai được phép thêm file.
4. Từ chối bytes không bắt đầu bằng chữ ký ZIP (`not-a-zip`).
5. **Không bao giờ** tự động ghi entry ra đĩa.

---

## 15. Giới hạn kích thước và ngân sách

| Hạng mục | Giới hạn |
|---|---|
| File `.bugcap` | 10 MB |
| Tổng dung lượng giải nén | `min(200 MB, 100× compressed)` |
| Body mỗi phía | 64 KB |
| Tổng body trong một capsule | 2 MB |
| Screenshot | 2 MB |

Các giới hạn này phải nhất quán với nhau: 100 request × 64 KB × 2 phía đã là
12.8 MB, vượt cap file — nên **ngân sách tổng của body mới là ràng buộc thật**,
không phải giới hạn từng body.

Khi vượt ngân sách, producer MUST loại bớt theo một thứ tự xác định (body lớn
nhất trước), ghi `omissionReason: "size-limit"`, và **MUST NOT im lặng**.

---

## 16. Phân loại tín hiệu diff (v0.1)

`weight`: 3 = đỏ, 2 = cam, 1 = thông tin. `visibility`: `shown` hoặc `hidden`.

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
| `environment-changed` (khác) | 1 | shown | low |
| `console-message-changed` | 1 | shown | low |
| `state-value-changed` (string/số) | 1 | **hidden** | low |
| `action-only-in-broken` / `-baseline` | 1 | shown | low |

Quy tắc phân loại đáng chú ý:

- `field: string` → `field: string|null` là **`nullability-change`**, không
  phải `type-change`. Đây là một trong những bug phổ biến nhất.
- `duration-outlier` chỉ khi chênh `>= 1000ms` **và** `>= 3×`. Dưới ngưỡng bị
  đếm vào `dropped` với kind `duration-noise`.
- `state-value-changed` dạng boolean được **hiện**: một bit thông tin không thể
  là PII, nên một feature flag lật `false → true` vừa riêng tư vừa nhiều tín
  hiệu. String/số thì ngược lại — rất dễ là id hoặc timestamp — nên **ẩn mặc
  định**.

### Thứ tự trình bày

Sắp xếp theo, lần lượt:

1. `weight` giảm dần
2. `proximityMs` tăng dần — `offsetMs` trừ **bất thường đầu tiên**
   (console `error` đầu tiên hoặc status `>= 400` đầu tiên, cái nào sớm hơn).
   Âm nghĩa là trước bất thường.
3. bảng ưu tiên theo `kind`
4. `kind`, rồi `id`

Bước 3 tồn tại vì nếu không, thứ tự rơi vào so sánh chuỗi alphabet và
`presence-change` sẽ đứng trước `status-class-change` — tức là năm hệ quả của
một lỗi 500 sẽ chôn chính cái 500 đó xuống dưới.

`proximityMs` đo tới **bất thường đầu tiên** chứ không tới đầu phiên capture:
một request bình thường ở giây thứ 29 không đáng bị đẩy xuống chỉ vì nó xảy ra
muộn.

---

## 17. Trust budget

Mọi dòng diff MUST mang `confidence` và `reason` một dòng. Một dòng không tự
giải thích được vì sao nó đáng tin thì không đáng hiển thị.

Không bao giờ che giấu im lặng:

- Thứ bị ẩn nằm trong `hidden` kèm `defaultVisibility: "hidden"`.
- Thứ bị loại nằm trong `dropped` kèm **số lượng**, luôn hiện diện kể cả khi
  rỗng.
- Thứ bị người dùng bỏ qua nằm trong `suppressed` kèm `suppressedCount`.

`id` của signal MUST ổn định giữa các lần chạy — nếu không thì dismissal vô
nghĩa.

---

## 18. Điều đã biết là chưa đủ

Khai báo trung thực, không giấu:

- **`pathTemplate` chưa có ở v0.1.** Khoá ghép request là
  `method + pathname + chữ ký tập query key`. Hệ quả: `/products/123` và
  `/products/456` là hai request khác nhau. Normalize template để lại v0.2;
  diff engine *có thể* tự suy template từ hợp của hai capsule mà không cần
  field lưu trữ.
- Nhiều request trùng khoá ghép được ghép **theo thứ tự**; số lượng lệch nhau
  sinh ra `request-only-in-*`. Việc ghép theo thứ tự là quy ước của v0.1.
- Worker, WebSocket, SSE chưa được capture; producer SHOULD khai trong
  `captureGaps` nếu chúng có mặt trên trang.
- Không có Start/Stop: capture giữ một ring buffer và đóng băng khi người dùng
  bấm. Cap: 500 event tổng / 200 network / 200 console / 100 action / 30 giây.
- `chrome.debugger` không được dùng ở v0.1.

---

## 19. Kiểm chứng

Mọi khẳng định ở trên MUST có test. Trạng thái hiện tại:

```
Test Files  10 passed (10)
     Tests  105 passed (105)
typecheck  exit 0
```

Lệnh:

```
pnpm test            # toàn bộ test
pnpm typecheck       # tsc --noEmit
pnpm check:schemas   # JSON Schema đã commit có khớp nguồn zod không
pnpm gen:fixtures    # sinh lại fixtures/*.bugcap
pnpm show:diff       # in diff end-to-end từ fixture đã commit
```

Fixture trong `fixtures/` là nhị phân đã commit, sinh tất định, và có test
chống drift: `checkout-working` (201, `{orderId,total,etaDays}`) so với
`checkout-broken` (500, `{error,traceId}`). **Body không được capture ở cả hai
phía** — toàn bộ tín hiệu schema đến từ `bodyShape`, đúng như §11 thiết kế.
