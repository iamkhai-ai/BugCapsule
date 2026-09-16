# Prior art — điều gì đã có, điều gì còn trống

- **Ngày:** 2026-09-16
- **Mục đích:** kiểm chứng (hoặc bác bỏ) tuyên bố novelty của BugCapsule trước khi
  đưa nó vào README. Tài liệu này tồn tại để **ngăn việc thổi phồng**, không phải
  để củng cố nó.

## 0. Cách đọc tài liệu này — mức độ tin cậy

`web_search` không dùng được trong môi trường này (plugin chưa cấu hình endpoint).
Toàn bộ khảo sát dựa trên HTTP thật: GitHub REST API, npm registry API, README gốc
qua `raw.githubusercontent.com`, và `llms.txt` của các docs site (plain text, không
cần JS).

Mỗi khẳng định dưới đây được gắn nhãn nguồn:

- **[T] — tôi tự fetch và tự đọc.** Có thể tái lập.
- **[Đ] — pass nghiên cứu uỷ quyền.** URL được ghi lại nhưng tôi **chưa** tự tái
  hiện. Đáng tin nhưng chưa phải bằng chứng trực tiếp.
- **[?] — chưa kiểm chứng.** Không được dùng tài liệu này để biện luận cho [?
  ].

Hai loại sai lệch cần nhớ:

- **Danh sách này không đầy đủ.** GitHub API sắp theo sao, nên một tool hay nhưng
  ít sao có thể nằm ngoài tầm. `chrome-network-differ` (1★) suýt nữa đã không được
  thấy.
- **"Không tìm thấy bằng chứng công khai" ≠ "không tồn tại".** Một tính năng beta
  chưa tài liệu hoá thì không quan sát được từ bên ngoài. Tuyên bố trong mục 6 được
  viết để chịu được cách đọc này.

---

## 1. Kết luận ngắn

Tuyên bố ban đầu — *"chưa ai làm diff để bỏ việc reproduce"* — **sai ở dạng đó**.
Mọi mảnh riêng lẻ đều đã có người làm, có mảnh rất lớn.

Nhưng một phiên bản **hẹp hơn** thì sống sót, và sống sót mạnh:

1. **Không sản phẩm nào trong nhóm bug-capture/session-replay có tính năng tự động
   so sánh hai capture.** Việc capture console/network thì phổ cập; việc **tính ra
   diff** thì vắng mặt ở mọi nơi được khảo sát.
2. **Không tài liệu của bất kỳ sản phẩm nào trong nhóm đó bàn tới việc so sánh
   schema/shape của JSON response** — kể cả như một tính năng thủ công. Đây là ô
   trống rộng nhất và là hỗ trợ mạnh nhất cho tuyên bố.
3. **Diff JSON field-by-field thì đã có**, ở đúng một tool rất nhỏ và **thủ công**
   (`chrome-network-differ`). Đây là điểm hẹp nhất phải nhượng bộ.

---

## 2. Năm nhóm prior art

| Nhóm | Đại diện | Nó chiếm chỗ nào |
|---|---|---|
| A. Bug capture / session replay | Jam, Bird Eats Bug, LogRocket, OpenReplay, Marker.io, Usersnap | **Capture** console/network/state. Không diff. |
| B. Visual regression | Percy, Chromatic, BackstopJS, reg-suit + 1174 repo khác | Baseline-vs-current, nhưng trên **đầu ra thị giác** |
| C. API spec diff | `oasdiff` (1364★), `optic` (1533★), `openapi-changes` (358★), `Azure/openapi-diff` (290★) | Diff **schema**, nhưng trên **spec khai báo**, không phải quan sát runtime |
| D. Suy schema từ traffic | `mitmproxy2swagger` (**9608★**) | Sinh spec từ traffic thật. **Không diff.** |
| E. HAR diff | `sitespeedio/compare` (119★), `stefanjudis/har-diff` (5★), `edilec/network-waterfall-diff` (0★) | So hai capture, nhưng trên **thời gian**, không cấu trúc |

### A. Bug capture / session replay — capture phổ cập, diff vắng mặt

**Jam.dev [T]** — tôi tự tải `https://jam.dev/docs/llms.txt` (HTTP 200, 66 dòng
index, phủ 70+ trang docs). Trong toàn bộ index, số dòng khớp
`diff|compare|baseline|regress` là **1**, và đó là trang pricing:

> `- [Pricing](https://jam.dev/docs/pricing.md): Compare Jam plans and choose the right plan for your workspace.`

Không có trang so sánh nào. Không có lệnh `diff`/`compare` nào.

Jam capture console + network, kể cả body **[Đ]**:
> *"Jam captures request and response details, including bodies, for all XHR and fetch requests on the page."*

Nhưng **storage chỉ thủ công** **[Đ]**: muốn có localStorage thì lập trình viên phải
tự gọi `jam.metadata()`.

**Bird Eats Bug (nay là Bug Capture by BrowserStack) [T]** — tôi tự tải
`https://docs.birdeatsbug.com/latest/reports/devtools.html` và tự đọc. Đây là
sản phẩm **duy nhất** khảo sát được có capture storage tự động:

> *"localStorage updates (set, remove, clear) · sessionStorage updates (set, remove, clear)"*
>
> *"Bird records the method calls and **the key-value pairs** that were set, removed, or cleared. If the website being recorded is using custom localStorage or sessionStorage implementations, Bird might not record as expected."*
>
> *"The following types of data are currently not captured by our recorders: Changes to cookies · IndexedDB · Sourcemaps · Recording of activity inside iFrames embedded into the recorded page"*
>
> *"The Bird recorder captures Network requests, along with request responses..."*

Hai điều rút ra. Thứ nhất, storage capture **không** phổ cập: Bird là ngoại lệ, và
nó tự khai không capture cookie/IndexedDB/iframe. Thứ hai — và đây là điểm đối lập
trực tiếp với BugCapsule — **Bird ghi cả key-value pairs**, tức ghi *value* thật.
BugCapsule giữ tên key và `valueType`, không bao giờ giữ value.

**LogRocket, OpenReplay, Marker.io, Usersnap, Highlight.io [Đ]** — cùng hình dạng:
console + network có, quan hệ store của framework (Redux/VueX/Pinia/NgRx/Zustand/MobX)
có, và **không có tính năng so sánh nào** trong index tài liệu đầy đủ. Hai chi tiết
đáng nhớ:

- LogRocket có một trang tài liệu tên **"Comparisons"** — nhưng đó là *định vị cạnh
  tranh*, không phải tính năng. Dễ đọc nhầm thành diff.
- **Highlight.io đã chết**: miền `highlight.io` nay 301 sang `launchdarkly.com`
  (đã bị LaunchDarkly mua).

### B. Visual regression — baseline diff, nhưng trên pixel

**[T]** Nhóm này rất lớn: GitHub có **1174 repo** khớp `visual regression in:name`,
dẫn đầu là `Visual-Regression-Tracker` (712★) và `cypress-visual-regression` (661★).
Percy tự mô tả trong `docs.percy.io/llms.txt`:

> *"Visual testing as a service. Get visual insight across your complete application on every commit."*

**Cảnh báo về mức độ tin cậy:** đây là nhóm mà tôi đã **thất bại hai lần** trong
việc thu thập chi tiết cấp sản phẩm. `www.chromatic.com/llms.txt` → 404.
`playwright.dev/llms.txt` → 404. `docs.percy.io/llms.txt` → 200 nhưng chỉ là stub
329 ký tự. Nên khẳng định "Percy/Chromatic chỉ diff pixel" ở đây dựa trên **tên và
cấu trúc của phạm trù** ("visual regression"), không dựa trên quote đã đọc. Nếu
tài liệu này được trích dẫn công khai, chỗ này cần một pass nữa. **[?]**

Điều chắc chắn: **không nhóm nào ở đây so schema JSON của response.**

### C + D. Diff schema thì có, suy schema từ traffic thì có, ghép lại thì gần như trống

**[T]** Nghịch lý thú vị nhất của khảo sát này:

- Diff schema API là **phạm trù trưởng thành**: `oasdiff` 1364★, `opticdev/optic`
  1533★, `pb33f/openapi-changes` 358★, `Azure/openapi-diff` 290★. Nhưng tất cả
  diff **spec được khai báo**, không phải hai lần quan sát runtime.
- Suy schema từ traffic cũng **trưởng thành**: `alufers/mitmproxy2swagger`
  **9608★** — *"Automagically reverse-engineer REST APIs via capturing traffic"*.
  Nhưng nó **không diff**.
- Ghép hai bước đó lại — suy schema từ traffic **rồi** phát hiện thay đổi phá vỡ —
  thì chỉ có `Akhilucky/ContractDrift` (**0★**) đang thử. Về mặt khái niệm đây là
  prior art gần nhất với lõi BugCapsule, và nó không có adoption.

### E. HAR diff — có thật, nhưng so thời gian, và đã chết

**[T]** `sitespeedio/compare` (119★), README:
> *"Compare HAR files — Make it easier to find regressions by comparing your HAR files."*

Nhưng cơ chế là **waterfall + blend slider**, lấy cảm hứng từ WebPageTest HAR
compare viewer. Tức so **thời gian tải**, không so cấu trúc response.

`stefanjudis/har-diff` (5★) — *"Tool to get diff statistics of two har-files"*.
Badge trong README là Travis CI, Gemnasium, Coveralls, gulp — toàn dịch vụ đã chết
⇒ **bỏ hoang khoảng 2015**.

`edilec/network-waterfall-diff` (0★) — README 98 ký tự, *"Compare network waterfalls
across builds and show changed request costs."*

**[T]** npm registry: **không có package nào** cho việc diff HAR/network response.
Các kết quả gần nhất đều là thư viện chung (`deep-object-diff`, `diff`,
`diff-sequences`) hoặc chỉ là định dạng/validate (`har-schema`, `chrome-har`).
Ô này trống.

---

## 3. Bốn thứ trông như diff nhưng không phải — và BugCapsule phải tự phân biệt

Đây là phần dễ bị Reviewer bắt bẻ nhất, nên phải nói trước:

1. **Cảnh báo hồi quy theo metric/time-series.** OpenReplay Monitors, LogRocket
   Issues, LaunchDarkly regression detection **[Đ]**. Là thống kê trên dashboard tổng
   hợp, không phải so hai capture.
2. **Delta state trong một phiên.** LogRocket hiển thị *"the difference in state
   before and after"* một Redux action **[Đ]**. Một phiên, một action — không phải
   hai lần chạy.
3. **Tương đồng/tóm tắt bằng AI.** LogRocket Galileo, OpenReplay *"Similar Sessions"*
   dùng embedding để tìm phiên giống nhau **[Đ]**. Là tương đồng, không phải so
   từng field.
4. **So hai request do người dùng tự ghim.** Xem mục 4.

---

## 4. Prior art gần nhất, và chính xác nó khác gì

### `himanshuain/chrome-network-differ` — "API Differ" (1★) **[T]**

Đây là thứ **gần nhất** với BugCapsule, và phải được nêu thẳng trong README.
Nguyên văn README:

> *"Side-by-Side Diff — Pin any two requests as **A** and **B** to get a structured, color-coded diff of their response bodies, request payloads, or headers"*
>
> *"Deep JSON Diff Engine — Recursively compares nested objects and arrays, highlighting added, removed, and changed fields"*
>
> *"Intercept & Capture — Automatically captures fetch and XMLHttpRequest calls on any tab with a single click"*

Khác biệt cụ thể, không phải khác biệt về marketing:

| | `chrome-network-differ` | BugCapsule |
|---|---|---|
| Đơn vị so sánh | Hai **request** do người dùng tự ghim, trong một phiên | Hai **capsule** của cả một luồng |
| Ghép cặp | Thủ công (người dùng chọn A và B) | Tự động theo `method + pathname + chữ ký query key` |
| Phạm vi | Chỉ network | network + console + state + environment + actions |
| Header | **Có capture** | **Không có field header** trong format v0.1 |
| Body | Capture value đầy đủ | Mặc định chỉ `bodyShape`; value không rời page context |
| Định dạng | Extension DevTools | Format có version + JSON Schema công bố |
| Xếp hạng | Không | Theo weight → proximity → loại tín hiệu, kèm `confidence` + `reason` |

Nói cách khác: **"diff hai JSON payload" không còn là novelty.** "Diff toàn bộ một
luồng, tự động ghép cặp, và chỉ capture cấu trúc" thì vẫn là.

### `SaintPepsi/openjam` (2★) **[T]**

Bản open-source của Jam.dev, tự mô tả:

> *"🔒 **Nothing is ever uploaded — you have full control over your data.** Everything stays on your machine; the entire bug report is a single local file that only travels if you choose to share it."*
>
> *"...captures console logs, network requests, JS errors, screenshots, device/environment info, a full DOM session replay (rrweb), and opt-in local mic narration onto a single correlated timeline, then exports a **self-contained HTML bug report** — open it offline and watch the session play back."*
>
> *"No backend, no account, no telemetry."*

Hệ quả: **"local-first, một file, mở offline, không backend, không account" không
còn là điểm khác biệt.** BugCapsule không được trình bày nó như thể là của riêng
mình.

Khác biệt còn lại: OpenJam **không có diff**, và nó capture **DOM session replay
(rrweb)** — tức capture nhiều dữ liệu nhạy cảm hơn hẳn. BugCapsule từ chối DOM
replay có chủ ý. README của OpenJam mang badge *"100% AI generated"*; nêu ra một
cách trung tính vì nó cho thấy ý tưởng này "đang trong không khí", chứ không phải
để đánh giá.

---

## 5. BugCapsule **không** được tuyên bố

Ghi thành danh sách để tiện đối chiếu khi viết README:

- ❌ "Chưa ai làm diff." → Có, `chrome-network-differ`, mức field-level.
- ❌ "Chưa ai diff baseline-vs-broken." → Có, visual regression (1174 repo) và API
  spec diff (`oasdiff` 1364★).
- ❌ "local-first / một file / mở offline / không backend." → OpenJam nói y hệt.
- ❌ "Capture console + network + state." → Phổ cập: Jam, LogRocket, OpenReplay,
  Bird, Marker.io, Usersnap.
- ❌ "Suy schema từ traffic." → `mitmproxy2swagger`, 9608★.
- ❌ "Privacy-first." → Mọi sản phẩm trong nhóm A đều tự nhận vậy.

---

## 6. Tuyên bố đề xuất (chịu được cách đọc "không tìm thấy ≠ không tồn tại")

> BugCapsule captures the **shape** of a broken session, never its values — so two
> runs of the same flow can be **diffed by default**, offline, in a portable file
> that anyone can implement against a versioned JSON Schema.

Ba mệnh đề, và bằng chứng cho từng cái:

1. **Không tài liệu nào của nhóm bug-capture/session-replay bàn tới việc so sánh
   schema/shape của JSON response.** Ô này trống ở cả 7 sản phẩm khảo sát, kể cả
   như tính năng thủ công. Đây là mệnh đề mạnh nhất.
2. **Không sản phẩm nào tự động so hai capture.** Capture thì phổ cập, tính toán ra
   diff thì vắng mặt. Prior art duy nhất làm diff field-level
   (`chrome-network-differ`) là thủ công, chỉ network, và capture cả header/body.
3. **Capture cấu trúc làm mặc định là chỗ độc nhất thật.** Đối thủ hoặc capture
   value rồi phải redact (Bird ghi cả key-value pairs; Jam và chrome-network-differ
   ghi body), hoặc không capture gì. Không ai phát hành một **format có version +
   JSON Schema** cho việc này — tất cả đối thủ là sản phẩm UI hoặc script rời.

Điểm thứ ba quan trọng nhất với mục tiêu Codex for Open Source: một **định dạng**
là loại đóng góp khác về bản chất so với một sản phẩm — nó là hạ tầng để người khác
xây tiếp, và nó kiểm chứng được (`spec/0.1/*.schema.json` + test chống drift).

---

## 7. Việc chưa làm

- **[?]** Chi tiết cấp sản phẩm của Percy và Chromatic: chưa đọc được doc body.
  Hai lần thử đều thất bại. Cần một pass nữa nếu muốn trích dẫn công khai.
- **[?]** Các sản phẩm nhóm A: mới chỉ khảo sát tài liệu **công khai**. Không loại
  trừ được một tính năng beta chưa tài liệu hoá.
- **[?]** Chưa khảo sát: Sentry, Datadog RUM, FullStory, Heap, Smartlook, SessionStack,
  Testsigma, QA Wolf, Meticulous, Replay.io.
- **[?]** Chưa kiểm tra Chrome Web Store: số người dùng thật của
  `chrome-network-differ` và của các extension cùng loại. Số sao GitHub không đo
  được mức độ adoption trong thế giới extension.
- **[?]** Chưa khảo sát phía **thương mại** theo hướng contract testing
  (Pact, Schemathesis, Dredd) — có thể có overlap về mặt khái niệm với việc so
  shape của response.
