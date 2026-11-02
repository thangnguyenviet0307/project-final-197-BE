# Rà soát rủi ro sau sửa lỗi — 31/10/2026

**Cập nhật:** người dùng đã yêu cầu sửa các mục mới và chọn thời hạn giữ kho 24 giờ. Xem [kết quả sửa và kiểm chứng](risk-fix-results-2026-10-31.md). Nội dung bên dưới giữ lại bằng chứng tại thời điểm rà soát; các công cụ tái hiện đã được chuyển sang kiểm tra hành vi sau sửa.

Đợt này đọc lại mã nguồn hiện tại của hai repository, tập trung vào checkout/receipt/giữ kho, khôi phục request, phiên đăng nhập, phân quyền, chuyển quyền sở hữu, CRUD catalog và các phần vừa sửa. Không sửa mã ứng dụng; chỉ thêm tài liệu và công cụ tái hiện cục bộ. Không đọc `.env`, kết nối production, migrate dữ liệu hay deploy.

Chưa phát hiện P0 được xác nhận trong phạm vi đã đọc. Có một lỗi khôi phục checkout đáng ưu tiên, một rủi ro nghiệp vụ giữ kho và một thiếu sót bảo vệ endpoint nhạy cảm. Kết quả không phải audit toàn bộ source hoặc chứng nhận production an toàn.

## R-001 — P1: lỗi đọc pending checkout bị coi là chưa có request

**Bằng chứng:** FE `src/features/checkout/utils/pending-checkout.ts:14-20` trả `null` cho cả không có bản ghi, lỗi đọc storage và lỗi parse/schema. `src/features/checkout/hooks/use-checkout-form.ts:18` chỉ đọc lúc khởi tạo; khi `attempt.current` rỗng, dòng 53 sinh requestId mới và dòng 55 lưu vào cùng khóa.

**Tình huống:** request A đã được lưu và gửi; server có thể đã tạo đơn nhưng client chưa nhận kết quả. Khi vào lại trang, đọc sessionStorage lỗi tạm thời nên form tin rằng không có request A. Sau khi storage hoạt động lại, người dùng submit và request B ghi đè A. Backend deduplicate theo customerId/requestId nên A và B là hai yêu cầu độc lập; nếu A đã commit, B có thể tạo đơn thứ hai khi các điều kiện đặt hàng vẫn hợp lệ. Lỗi cũng xảy ra khi bản ghi cũ không parse được. Nếu storage tiếp tục chặn cả ghi, việc gửi mới hiện được chặn; rủi ro nằm ở lúc đọc thất bại nhưng lần ghi sau thành công.

**Xác minh:** hai diagnostic test tái hiện việc đọc trả null và bản ghi cũ bị thay bằng requestId mới. Chưa tái hiện tạo hai đơn bằng browser kết nối MongoDB. Đường dẫn dẫn tới đơn trùng được xác định từ cơ chế receipt hiện hành, không phải bằng chứng đã có đơn trùng ngoài thực tế.

**Phương án:**

1. Đổi kết quả đọc thành trạng thái rõ: `empty | pending | unavailable | invalid`. Chỉ `empty` cho phép tạo request mới; các trạng thái lỗi khóa gửi mới và cho đọc lại.
2. Giữ bản ghi không hợp lệ, không tự ghi đè/xóa. Khi storage phục hồi, đọc lại pending trước khi mở khóa. Có thể giữ bản sao pending trong bộ nhớ theo identity trong cùng phiên; bản sao này không thay thế khả năng khôi phục qua reload.
3. Trước khi lưu request mới, xác nhận khóa vẫn không chứa pending chưa giải quyết. Giữ nguyên body/requestId khi kết quả cũ còn chưa rõ; không tạo lại request chỉ vì lỗi storage hoặc parse.
4. Kiểm thử hook/UI đầy đủ: A commit nhưng response timeout; remount lỗi đọc; storage phục hồi; chỉ A được retry, B không được tạo. Kiểm tra cả guest/Customer, dữ liệu sai schema và đổi tài khoản.

Đây là mục nên sửa đầu tiên vì ảnh hưởng tính đúng đắn của đặt hàng.

## R-002 — P1 có điều kiện: đơn COD vãng lai có thể giữ tồn kho không có thời hạn tự giải phóng

**Bằng chứng:** BE `src/routes/v1/storefront.route.ts:13` cho checkout không đăng nhập với giới hạn năm request/IP/15 phút/process. `src/validations/checkout.validation.ts:17` chấp nhận tối đa 100.000 đơn vị mỗi dòng; service vẫn kiểm tra tồn thực. `src/services/checkout.service.ts:53-57` giữ kho và tạo Pending ngay. `src/models/orders.model.ts` chưa có mốc hết hạn reservation; `src/server.ts` chỉ khởi động worker dọn ảnh, chưa có worker hết hạn đơn.

**Ảnh hưởng:** một đơn vãng lai hợp lệ về hình thức có thể giữ toàn bộ lượng đang bán của một SKU nếu lượng đó nằm trong giới hạn cho phép. Kho vẫn bị giữ cho đến khi đơn được xử lý/từ chối thủ công; chưa có cơ chế tự giải phóng. Rate limit số request không hạn chế lượng hàng giữ trong một request. Chưa thử tấn công hay chứng minh có lạm dụng thực tế. Nếu cửa hàng chủ động chọn quy trình xác nhận thủ công không có SLA, đây là rủi ro kinh doanh của quy trình đó, không phải lỗi transaction/bán vượt kho.

**Phương án cần chốt nghiệp vụ:**

- Trước mắt: giới hạn lượng/giá trị đơn vãng lai theo chính sách cửa hàng; cảnh báo đơn bất thường và Pending quá hạn; đặt SLA nhân viên xác nhận. Kiểm soát theo IP/điện thoại chỉ là lớp bổ sung, điện thoại chưa xác minh không phải danh tính đáng tin cậy.
- Bền vững: quy định thời hạn giữ kho cho đơn vãng lai chưa xác nhận và/hoặc xác minh số điện thoại trước khi giữ lượng lớn. Không tự chọn thời hạn trong mã khi chưa chốt chính sách.
- Nếu dùng hết hạn: worker có lease/batch, chỉ chuyển các đơn guest Pending đủ điều kiện, hoàn tồn bằng service chung trong cùng relations transaction; cạnh tranh với start/reject/cancel chỉ một bên thắng. Không dùng TTL xóa Order vì TTL không hoàn kho.
- Giữ receipt lâu dài để request cũ không bao giờ tạo lại đơn; làm rõ UI khi xác nhận ban đầu đã có nhưng đơn thực tế đã hết hạn. Test hết hạn so với staff nhận đơn, chạy worker lặp, nhiều worker và rollback hoàn tồn.

## R-003 — P2: chuyển quyền sở hữu thiếu giới hạn thử mật khẩu

**Bằng chứng:** `src/routes/v1/users.route.ts:20` có authenticate/permission/validation nhưng không có limiter; `src/services/users.service.ts:46` xác minh mật khẩu hiện tại. Đây là endpoint riêng, không đi qua limiter `/auth`.

**Tái hiện:** `pnpm.cmd exec node docs/reviews/reproduce-ownership-limit.mjs` gửi 40 request loopback với phiên Super Admin giả lập, tất cả đi tới service và trả 400, không request nào trả 429. Database và service mật khẩu được mock; phép thử xác nhận tuyến HTTP thiếu throttle, không đo CPU/không thử brute-force mật khẩu thật.

**Điều kiện/ảnh hưởng:** phải có access token Super Admin hợp lệ mới tới bước này; người chưa đăng nhập và Admin/Staff vẫn bị chặn. Khi token chủ sở hữu bị lấy, bước kiểm tra mật khẩu còn lại có thể bị thử liên tục trong thời gian token còn hiệu lực. Việc kiểm mật khẩu cũng dùng tài nguyên hash. Chưa xác nhận chiếm quyền hay DoS thực tế.

**Phương án:** thêm limiter riêng trước xác minh mật khẩu, kết hợp actor ID và IP; khuyến nghị ngưỡng ban đầu khoảng năm lần thất bại/15 phút/tài khoản, điều chỉnh theo chính sách. Trả 429/Retry-After, theo dõi sự kiện đã làm sạch, không log mật khẩu/token. Không khóa vĩnh viễn tài khoản bằng một IP tấn công. Nếu nhiều instance, dùng gateway/store chung. Với thao tác đặc biệt nhạy cảm có thể thêm phiên tái xác thực ngắn hạn/MFA. Test số lần vượt ngưỡng, cô lập actor, 401/403 và không gọi password service sau 429.

## Hai điểm triển khai đã biết vẫn chưa đóng

- **F-005 — index production:** `autoIndex=false` trong production, startup chỉ chủ động tạo receipt/editorial indexes. Chưa có bằng chứng User/Customer/Product/Order indexes thật đầy đủ. Đây là rủi ro có điều kiện, không kết luận database đang thiếu index. Chạy công cụ audit hiện có ở chế độ read-only, đánh giá blockers rồi mới xin phê duyệt apply; không drop conflict/sửa duplicate tự động.
- **F-007 — proxy/rate limit:** cấu hình tường minh đã có nhưng chưa xác minh peer/header trên hosting, và limiter vẫn theo process. Kiểm hai IP độc lập, header giả, 429/Retry-After và chính sách nhiều instance trên staging trước khi coi hạn mức có hiệu lực như mong muốn.

## Thứ tự thực hiện đề xuất

1. Sửa R-001 và thêm regression test theo luồng end-to-end cục bộ.
2. Thêm limiter R-003 — thay đổi nhỏ, không đổi nghiệp vụ đặt hàng.
3. Chốt chính sách R-002 rồi triển khai giới hạn/xác minh/hết hạn cùng kiểm thử cạnh tranh transaction.
4. Nghiệm thu F-005/F-007 ở môi trường được phép trước khi mở traffic thật.

## Phạm vi kiểm chứng và giới hạn

Các diagnostic test cố ý khẳng định hành vi lỗi hiện tại để tái hiện. Chúng pass có nghĩa đã tái hiện được vấn đề, không có nghĩa vấn đề đã được sửa. Khi sửa R-001/R-003, thay chúng bằng regression test yêu cầu hành vi an toàn.

- FE: `pnpm.cmd exec vitest run tests/review-pending-checkout-risk.test.ts tests/checkout.test.tsx tests/article-detail-effects.test.tsx tests/post-category-navigation.test.tsx tests/review-list-page.test.tsx` — 20/20 đạt.
- BE: `pnpm.cmd exec node docs/reviews/reproduce-ownership-limit.mjs` — 40 request, 40 lần tới service, 0 lần throttle, không database access.
- BE: `pnpm.cmd typecheck` đạt; `pnpm.cmd test` đạt 304/304, không skipped.
- FE: `pnpm.cmd typecheck` đạt; `pnpm.cmd test` đạt 526/526 trên 71 file (gồm hai diagnostic mới).

Chưa chạy browser E2E/visual, load benchmark, dependency vulnerability audit, kiểm hosting hay truy vấn production. Integration MongoDB 20/20 của lượt sửa trước là bằng chứng lịch sử, không ghi nhận là chạy lại trong lượt review này.
