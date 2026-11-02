# Bộ báo cáo review dùng chung giao diện — template 1.0.0

> Đọc README và template hiện có, tạo dữ liệu JSON mới, rồi sinh HTML bằng script. Không thiết kế lại giao diện.

Chỉ review và tạo artifact. Không sửa source ứng dụng, cài dependency, seed/migrate/reset database, commit hoặc deploy trong giai đoạn review. Đọc AGENTS.md của cả hai repo và PROJECT_RULES.md trước khi khảo sát. Không đọc/đưa secret, mật khẩu, token, connection string hoặc dữ liệu cá nhân vào dữ liệu báo cáo.

Lúc khảo sát chỉ có các báo cáo HTML tĩnh dưới `reports/`, chưa có bộ template/schema/renderer tương đương. Template 1.0.0 kế thừa bảng màu, panel và mục lục của báo cáo trước, chuẩn hóa thành một giao diện sáng dùng lại được. Các báo cáo cũ không bị ghi đè.

## Vai trò các file

| File | Vai trò |
| --- | --- |
| `review-report.template.html` | Giao diện cố định: CSS, layout, màu, JavaScript lọc/tìm kiếm/in; một placeholder dữ liệu. Không sửa mỗi lần review. |
| `review-report.schema.json` | Hợp đồng dữ liệu JSON Schema 2020-12, cấu trúc chi tiết và enum; templateVersion 1.0.0. |
| `review-report.example.json` | Ví dụ giả lập có isExample=true và nhãn rõ; không dùng như kết quả project thật. |
| `review-report-2026-10-31.json` | Kết quả khảo sát working tree hiện tại, gồm evidence, coverage và giới hạn. |
| `review-report-2026-10-31.html` | HTML độc lập sinh từ template/JSON; mở trực tiếp, không fetch JSON hoặc tài nguyên ngoài. |
| `render-review-report.mjs` | Renderer Node.js chỉ dùng API có sẵn, validation subset, chống script injection, không eval, không cần package mới. |
| `verify-review-report.mjs` | Kiểm thử artifact/validation/chống ghi đè và DOM tùy chọn bằng jsdom đã cài tại FE; không phải test ứng dụng/DB. |
| `verification-results.json` | Biên bản kiểm tra report kit và giới hạn trực quan; bổ sung khi bàn giao. |

Thư mục `docs` đang bị ignore bởi cấu hình repository. File vẫn tồn tại trên máy; bộ này không tự sửa `.gitignore`, stage hoặc commit. Khi người dùng muốn version-control bộ template cần chủ động đưa đúng thư mục vào Git.

## Tạo báo cáo mới

1. Đọc bộ này, AGENTS.md và business rules. Khảo sát source hiện tại, ghi branch/commit/dirty của từng repo; không dùng commit HEAD để giả định working tree sạch.
2. Copy cấu trúc `review-report.example.json` thành file ngày review, đổi isExample=false và nhập kết quả thật. Field không biết dùng null hoặc mảng rỗng đúng schema. Không chép finding cũ như lỗi mới nếu source đã sửa.
3. Dùng ngày theo Asia/Saigon trong tên. Nếu trùng ngày, dùng `-02`, `-03` cho cả JSON và HTML. Không ghi đè lịch sử.
4. Chạy tại root Backend (PowerShell dùng pnpm.cmd):

   ```powershell
   pnpm.cmd exec node docs/reviews/render-review-report.mjs --data docs/reviews/review-report-2026-10-31.json --out docs/reviews/review-report-2026-10-31.html
   ```

   Lần sau thay ngày/hậu tố ở hai đường dẫn. Script không tự đổi tên; báo lỗi nếu HTML đã tồn tại. `--force` là tùy chọn ghi đè rõ ràng, chỉ dùng với artifact được phép tái sinh; ưu tiên file hậu tố mới khi review khác lần. Dù có --force cũng không cho ghi đè input/template/schema/renderer. Output phải là `.html`, input `.json`; thư mục đầu ra phải có sẵn.

5. Kiểm tra artifact:

   ```powershell
   pnpm.cmd exec node docs/reviews/verify-review-report.mjs --data docs/reviews/review-report-2026-10-31.json
   ```

   Verifier dùng Node và jsdom **đã có** ở FE sibling cho DOM tests. Trên máy khác có thể chỉ rõ `--dom-package ../project-final-197-FE/package.json`. Nếu không có jsdom, chỉ kiểm Node và ghi rõ DOM tests skipped; không tự cài package. Renderer không phụ thuộc jsdom hoặc FE và vẫn hoạt động độc lập.

6. Mở HTML trong browser: desktop, mobile, zoom, keyboard, bộ lọc kết hợp, không kết quả, expand/collapse và preview in A4 ngang. Nếu không có browser, ghi chưa kiểm trực quan; jsdom không chứng minh layout/responsive/PDF đúng.

## Cấu trúc dữ liệu và enum

Tất cả field liệt kê trong schema đều required; object không nhận field lạ. Các mảng có thể rỗng trừ topPriorities phải đúng **5 mục** và affectedLayers không rỗng. Chuỗi mô tả phải có nội dung; trường có thể chưa biết được khai báo nullable riêng (commit/branch, evidence.line/symbol, executedAt, repository.dirty).

- `templateVersion`: phải khớp schema và meta version của template.
- `reportMeta`: projectName, reviewedAt ISO có timezone, reviewer, isExample, repositories, branch/commit chung (null nếu không gộp được), scope và limitations. Mỗi repository có name/path/branch/commit/dirty/notes.
- `overview`: summary, demoReadiness, strengths/blockers, stack có layer/technology/evidence.
- `coverage`: id/module/layer/status/paths/notes; mức `reviewed`, `sampled`, `not_reviewed`. `reviewed` chỉ nghĩa đã đọc luồng được nêu, không audit mọi dòng toàn repo.
- `findings`: id/title/severity/verificationStatus/module/layer/evidence/preconditions/reproductionSteps/expectedBehavior/actualBehavior/impact/recommendation/verificationMethod.
- Severity: `P0`, `P1`, `P2`, `P3`. Verification: `confirmed`, `risk`, `not_found`, `improvement`. Không nâng severity để báo cáo có vẻ nghiêm trọng. Confirmed có thể là xác nhận static, nhưng phải nói chưa tái hiện runtime nếu đúng.
- Layer: `BE`, `FE`, `DB`, `Integration`, `Deployment`.
- `featureMatrix`: id/module/fe/be/database/integration/status/remainingIssues/evidence. Status `implemented`, `partial`, `not_found`, `unverified`; implemented hiển thị “Triển khai theo code”, không phải E2E đạt.
- `missingFeatures`: id/title/priority/currentState/evidence/rationale/minimumScope/affectedLayers/difficulty/estimatedEffort/assumptions/dependencies/acceptanceCriteria. Priority `core`, `recommended`, `later`; difficulty `low`, `medium`, `high`. Ước lượng luôn kèm giả định/phụ thuộc.
- `actionPlan`: id/title/priority/timing/dependsOn/scope/deliverables/acceptanceCriteria. priority là severity đề xuất xử lý, không phải điểm chất lượng.
- `manualTests`: id/actor/scenario/steps/expectedBehavior/status; status `not_run`, `passed`, `failed` theo kết quả thật. Checkbox trên HTML chỉ ghi chú trong phiên, không sửa trạng thái của JSON.
- `checks`: id/repository/command/status/summary/scope/executedAt. Status `passed`, `passed_with_warnings`, `failed`, `not_run`, `historical`. Không ghi historical như test đã chạy trong phiên hiện tại; executedAt dùng null nếu không biết thời gian.
- `topPriorities`: đúng 5 object id/title/rationale/findingIds. Reference phải thuộc findings hiện tại; có thể rỗng nếu việc ưu tiên không gắn finding.
- Mỗi evidence là `{file,line,symbol,description}`; dùng đường dẫn repo và dòng hoặc symbol cụ thể. Không đưa đoạn source có secret. UI hiển thị text, không tạo link từ đường dẫn không tin cậy.

ID phải duy nhất **xuyên các mảng có ID**, nên dùng tiền tố F-/C-/M-/D-/A-/T-/K-/P-. Dữ liệu được sort findings theo P0→P3 khi render, không tự suy ra hoặc đổi mức độ.

## Validation: có giới hạn, không tuyên bố đầy đủ JSON Schema

Renderer đọc schema và thực thi subset dùng trong bộ hiện tại: local `$ref` tới `$defs`, type/union nullable, required/properties/additionalProperties:false, enum, const, pattern, minLength/maxLength theo Unicode code point, minimum/maximum, items/minItems/maxItems/uniqueItems; kiểm date-time ISO có timezone ở mức cú pháp + Date.parse. Kiểm thêm ID trùng và reference topPriorities.findingIds.

**Không phải validator JSON Schema 2020-12 tổng quát.** Không hỗ trợ allOf/anyOf/oneOf/if/then/else, remote refs, dependentSchemas, unevaluatedProperties hoặc mọi format. Date-time không phải RFC3339 validator lịch đầy đủ; uniqueItems dùng JSON serialization, không phải so sánh object sâu không phụ thuộc key order. Schema hiện tại không dùng các keyword ngoài subset này. Nếu sau này thêm keyword mới phải cập nhật validator/test hoặc dùng công cụ chuẩn đã được dự án cho phép; không tự cài dependency.

## Bảo mật và tính độc lập

- JSON nhúng ở script application/json, escape `<`, `>`, `&`, U+2028/U+2029. Chuỗi `</script>` không phá thẻ script.
- Nội dung report được dựng bằng DOM `textContent`/text nodes, không dùng eval hoặc innerHTML cho dữ liệu.
- Không CDN, font ngoài, framework, fetch hoặc tài nguyên mạng. File có thể mở bằng `file://` trong trình duyệt thông thường có JavaScript bật.
- Khởi tạo HTML cần JavaScript; nếu tắt JS sẽ có thông báo và có thể đọc JSON đi kèm. Không tuyên bố HTML là bản static-render không cần JS.
- Trước in mở toàn bộ detail; CSS print hiển thị mọi finding kể cả đang bị filter. Sau in trả trạng thái màn hình. Print view không bị coi là kết quả test browser nếu chỉ thử DOM events.

## Giữ giao diện và phiên bản

Những lần sau **chỉ đổi JSON**, không tự đổi CSS/layout/màu. Các báo cáo cũ độc lập, không tự cập nhật khi template đổi. Chỉ cập nhật template khi người dùng yêu cầu UI hoặc có lỗi template; tăng templateVersion ở meta HTML, schema và data tương ứng. Patch cho sửa tương thích, minor cho bổ sung tương thích có chủ đích, major cho đổi contract/layout không tương thích; ghi lý do vào changelog. Không chỉnh chỉ một nơi làm version lệch.

## Giới hạn của review dự án hiện tại

Không chạy database/seed/migration hoặc integration ghi dữ liệu lượt này. Test/build có thể tạo artifact dist/tsbuildinfo theo script đã kiểm. Không đọc .env. Chỉ khảo sát những file/luồng trong coverage; không dùng test pass làm bằng chứng mọi nhánh đã được đọc. Không xác nhận production index/hosting/cookie/provider chỉ từ config. Các lỗi xác nhận theo code có điều kiện và cách tái hiện nhưng chưa thao tác UI thật phải ghi rõ. Không thêm tính năng e-commerce như voucher/online payment thành bắt buộc nếu phạm vi COD đã đủ.
