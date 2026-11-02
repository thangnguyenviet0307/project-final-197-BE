# Kết quả sửa rủi ro — 31/10/2026

Áp dụng theo [báo cáo rà soát](risk-review-2026-10-31.md). Người dùng đã chọn **24 giờ** cho đơn vãng lai mới chưa được cửa hàng nhận. Không deploy, kết nối hay thay đổi dữ liệu production.

| Mục | Thay đổi | File chính |
| --- | --- | --- |
| R-001 | Phân biệt storage rỗng/pending/không truy cập được/dữ liệu sai. Hai trạng thái lỗi khóa gửi mới, giữ nguyên bản ghi và có nút kiểm tra lại. Đọc lại trước khi tạo request; không ghi đè request khác; chỉ xóa đúng requestId đã giải quyết. | FE `features/checkout/utils/pending-checkout.ts`, `hooks/use-checkout-form.ts`, trang checkout |
| R-002 | Đơn guest mới có hạn giữ kho 24 giờ. Worker mỗi phút, tối đa 20 đơn/lượt, chỉ xử lý Pending chưa phân công. Đổi trạng thái, hoàn kho và đánh dấu receipt trong một transaction; lỗi rollback và lùi lịch thử lại năm phút. | BE `services/guest-reservation.service.ts`, checkout/order services, Order/CheckoutRequest models, server |
| R-002 replay | Receipt được giữ sau khi xóa đơn, phần xác nhận ban đầu không bị viết lại. Receipt hết hạn trả 409 CHECKOUT_RESERVATION_EXPIRED, không tạo lại đơn. FE hiển thị lỗi rõ, giữ giỏ và bỏ request đã có kết quả dứt khoát. | BE checkout service/error middleware; FE checkout |
| R-003 | Giới hạn chuyển quyền: năm lần/actor/15 phút, hai mươi lần/IP/15 phút; authenticate/permission trước limiter và limiter trước password service. | BE rate-limit middleware, users route |

## Kiểm chứng

- Chuyển các test chẩn đoán storage thành regression test yêu cầu không ghi đè dữ liệu.
- Test UI guest và Customer: request timeout, remount lỗi đọc, khóa gửi mới, khôi phục và chỉ retry đúng request ban đầu; dữ liệu sai không bị xóa. Test receipt hết hạn không hiện thành công, không trừ giỏ và không gửi lại tự động.
- MongoDB replica set cục bộ: hạn 24 giờ; worker đồng thời chỉ hoàn tồn một lần; từ chối nhận/phân công đơn quá hạn; bỏ qua Customer/legacy/đơn đã nhận; rollback cả các dòng tồn kho đã phục hồi khi dòng sau lỗi; receipt tồn tại sau xóa đơn; cạnh tranh với từ chối thủ công; backoff khi receipt thiếu.
- HTTP ownership: 401/403 không tới password service, lần thứ sáu trả 429/Retry-After, actor khác có hạn mức riêng, cửa sổ hết hạn dùng lại được. Công cụ `reproduce-ownership-limit.mjs` nay kiểm hành vi đã sửa: 40 request, chỉ năm lần tới service và 35 lần throttle, không DB access.

| Repository | Lệnh đã chạy | Kết quả cuối |
| --- | --- | --- |
| BE | `pnpm.cmd typecheck` | Đạt |
| BE | `pnpm.cmd test` | 305/305 đạt, không skipped |
| BE | `$env:MONGOD_BINARY = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe'; pnpm.cmd test:integration:local` | 26/26 đạt trên replica set loopback mới; MongoDB đã dừng sau test |
| BE | `pnpm.cmd exec node docs/reviews/reproduce-ownership-limit.mjs` | Năm lần tới service, 35 lần trả 429 trên 40 request |
| FE | `pnpm.cmd typecheck` | Đạt |
| FE | `pnpm.cmd test` | 531/531 đạt, 71 file |
| FE | `pnpm.cmd lint` | Không có lỗi; còn một cảnh báo react-refresh có sẵn tại `src/router/route-fallback.tsx:6` |
| FE | `pnpm.cmd test:contracts` | 31 service request được kiểm, không HTTP/database |
| FE | `pnpm.cmd build` | Đạt |
| Cả hai | `git diff --check` | Đạt |

Trong lượt kiểm tra ban đầu, fixture mới đặt trước một test cũ làm sai giả định database còn rỗng; đã đặt lại thứ tự để giữ tiền điều kiện của test cũ. Test guest khôi phục cũng được sửa setup giỏ theo identity guest và reset hàng đợi mock giữa test. Các kết quả cuối bên trên đều bao gồm các điều chỉnh đó; không thay đổi assertion rollback hoặc nới kiểm tra nghiệp vụ để cho pass.

## Triển khai và giới hạn

- Không sửa deadline của đơn cũ. Customer và đơn Processing/đã phân công không tự hết hạn. Worker chỉ giải phóng đơn đủ điều kiện; thời điểm xử lý có thể trễ hơn 24 giờ do chu kỳ một phút, backlog hoặc dịch vụ tạm dừng. Theo dõi log khi không hoàn tồn được; không xóa đơn bằng TTL.
- Trước deploy, dùng `pnpm.cmd build` và `pnpm.cmd exec node scripts/ensure-core-indexes.mjs --database <database>` để audit. Index mới `{guestCheckout:1, orderStatus:1, reservationExpiresAt:1}` là index truy vấn bình thường; apply cần phê duyệt riêng và xác nhận tên database. Không tự drop index/xử lý duplicate. Chưa audit/apply production trong lượt này.
- Rate limit vẫn theo process. Cần nghiệm thu trust proxy/header và gateway dùng chung nếu nhiều instance (F-007); index production vẫn cần bằng chứng (F-005).
- Thời hạn giữ kho giới hạn việc giữ vô thời hạn, không phải xác minh người mua hay cam kết chống mọi spam COD. Giới hạn lượng/giá trị đơn và OTP/anti-bot là chính sách bổ sung riêng nếu cửa hàng cần.
- UI được kiểm bằng DOM tự động, chưa chạy browser E2E/visual hoặc benchmark tải production.
