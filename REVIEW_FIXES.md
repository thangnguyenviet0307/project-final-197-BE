# Xử lý các mục review 1–5 — 31/10/2026

## Phiên bản được kiểm chứng

- Backend HEAD ban đầu: `7fbb32b4e5cff67ccb92f6cb8303c089579ef08d`.
- Frontend HEAD ban đầu: `bff5e35b98ce2e3ef721e44a6196429001fca91d`.
- Cả hai working tree đã có thay đổi chưa commit trước khi thực hiện. Không reset, stash, stage hoặc commit các thay đổi có sẵn.
- Baseline gồm trạng thái Git và SHA-256 của các file source/config được lưu tại `.local-backups/review-fixes-baseline-2026-10-31.json` của BE. Không chứa giá trị biến môi trường hoặc nội dung .env.
- Manifest sau sửa được lưu riêng tại `.local-backups/review-fixes-verified-2026-10-31.json`. Đây là bản ghi working tree đã kiểm tra, không phải khẳng định hai repo là bản release sạch.
- Bản source tương ứng (hai repo, không gồm .env, node_modules, dist hoặc dữ liệu MongoDB) được lưu tại `.local-backups/review-fixes-verified-source-2026-10-31.zip`; SHA-256 của archive nằm trong manifest sau sửa. Artifact này giữ cả những thay đổi source có sẵn được kiểm tra cùng phiên bản hiện tại, không tạo commit thay người dùng.

## Thay đổi

1. Thêm `pnpm.cmd test:integration:local`. Runner dùng `MONGOD_BINARY`, cổng loopback ngẫu nhiên, thư mục dữ liệu ngẫu nhiên dưới `.local-backups`, replica set riêng và database test có tên ngẫu nhiên. Không đọc URI ứng dụng; subprocess nhận `MONGODB_URI` rỗng và `MONGODB_TEST_URI` của server tạm. Kết thúc dừng đúng server đã tạo, giữ log để kiểm tra. Không dùng Docker hoặc cài package.
2. `/api/v1/articles` dùng JSON budget 1 MiB. Giới hạn nội dung vẫn là 100.000 ký tự; budget chứa được cả Unicode UTF-8 và chuỗi Unicode escape gần biên, cùng metadata. Endpoint khác giữ budget mặc định. Lỗi body quá lớn trả 413 với thông báo rõ; không thay thông báo giới hạn file upload.
3. Footer chỉ liên kết tới các route thật; gỡ các link giới thiệu/FAQ/chính sách chưa có trang. Newsletter ghi rõ chưa khả dụng và vô hiệu hóa nhập/gửi; liên hệ ghi rõ xem trước và nút chỉ kiểm tra thông tin. Không tạo chính sách cửa hàng giả hoặc giả lập gửi thành công.
4. Editor bài viết theo dõi dirty state, xác nhận bỏ bản nháp khi đóng hoặc điều hướng, và bảo vệ trước khi reload/đóng tab bằng beforeunload. Chọn tiếp tục sửa giữ nguyên draft; mỗi lần mở editor có guard riêng. Save thành công đóng editor; lỗi API/version giữ draft như trước. Không tự nâng expectedVersion.
5. Customer refresh thua compare-and-swap trả `409 AUTH_REFRESH_CONFLICT`, khớp với cơ chế retry một lần bằng HttpOnly cookie hiện tại của FE. Token đã hết hạn/revoked/reused vẫn bị từ chối 401; không nới lỏng rotation.
6. Thêm công cụ `scripts/ensure-core-indexes.mjs` cho toàn bộ index khai báo của User, Customer, Product, Order. Mặc định chỉ đọc; apply bắt buộc tên DB và xác nhận trùng tên. Chỉ tạo index thiếu, không xóa/thay index, không sửa/xóa document, không dùng syncIndexes. Định nghĩa xung đột chặn apply trước khi tạo bất kỳ index nào. Duplicate data được MongoDB từ chối; không log dữ liệu trùng hoặc credential. Apply không phải transaction: nếu lỗi sau một số index đã tạo, các index trước đó còn lại; chạy lại có tính idempotent.

## Chạy integration cục bộ

PowerShell, tại Backend:

```powershell
$env:MONGOD_BINARY = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe'
pnpm.cmd test:integration:local
```

Đường dẫn trên là bộ MongoDB đã có trên máy trong phiên thực hiện; thay bằng đường dẫn bộ cài của máy khác. Runner không tự tải binary. Cần quyền mở listener loopback và chạy subprocess.

Đã chạy trên MongoDB **8.3.7** thực: **19/19 integration test đạt**, gồm rollback nhiều dòng, chống oversell, checkout replay, guest replay, hủy đồng thời/hoàn kho một lần, note concurrency và ownership transfer. Test index bổ sung xác nhận dry-run không tạo collection, apply bị chặn khi xác nhận sai, tạo đủ index trên DB mới, chạy lại không tạo thêm, không thay index xung đột và không sửa dữ liệu email trùng.

Hai lần thử runner đầu tiên chưa thành công vì driver không tự kết nối lại sau lần server selection timeout đầu tiên khi mongod đang khởi động. Đã sửa runner gọi connect trong vòng chờ và chạy thành công. Các server tạm đã được dừng. Không tác động tiến trình MongoDB có sẵn của máy.

## Index production: quy trình riêng, chưa thực hiện trên production

`NODE_ENV=production` vẫn tắt autoIndex như trước. Không tự tạo toàn bộ core indexes trong startup: cần kiểm tra và áp dụng có chủ đích trước khi mở traffic trên DB mới/nâng cấp.

1. Build source đã chốt bằng `pnpm.cmd build`.
2. Trong phiên vận hành bảo mật, cấu hình `MONGODB_URI` bằng cơ chế quản lý bí mật. Tool không tự đọc .env; không đưa URI có mật khẩu vào lệnh/chat/log.
3. Thay `TEN_DB` bằng **tên database thực tế**, chạy dry-run:

   ```powershell
   pnpm.cmd exec node scripts/ensure-core-indexes.mjs --database TEN_DB
   ```

   Xem từng collection, key, options và trạng thái `present/missing/conflict`. Dry-run không ghi dữ liệu hoặc tạo collection. Dùng tài khoản read-only nếu muốn cưỡng chế quyền chỉ đọc ở bước này.

4. Nếu có conflict (ví dụ email unique khác partial filter, phone legacy unique, variant SKU non-sparse), dừng để xử lý riêng. Tool không drop index để ép hợp lệ. Nếu duplicate data chặn unique index, xử lý dữ liệu theo kế hoạch được duyệt; không tự xóa/gộp tài khoản.
5. Sau khi người quản lý phê duyệt thay đổi index production, chọn cửa sổ vận hành phù hợp rồi chạy:

   ```powershell
   pnpm.cmd exec node scripts/ensure-core-indexes.mjs --database TEN_DB --apply --confirm-database TEN_DB
   ```

6. Đợi `verified:true`; chạy lại dry-run và kiểm tra tất cả index `present`. Không chỉ dựa vào việc process đã khởi động. Nếu apply lỗi, kiểm trạng thái thật trước khi chạy lại; không xóa các index mới theo phỏng đoán.

Chưa truy cập hoặc thay index/database production trong phiên này. Kết quả integration chỉ xác nhận công cụ trên DB tạm, không xác nhận index hiện có của production.

## Kiểm tra sau thay đổi

- BE: `pnpm.cmd typecheck`; `pnpm.cmd test` — 299 test đạt.
- BE: `pnpm.cmd test:integration:local` — 19 integration test đạt trên replica set tạm.
- FE: `pnpm.cmd typecheck`; `pnpm.cmd lint`; `pnpm.cmd test`; `pnpm.cmd test:contracts`; `pnpm.cmd build`.
- FE test: 519 test / 66 file đạt; contracts: 31 request đạt; lint: 0 error, 1 warning Fast Refresh có sẵn tại `src/router/route-fallback.tsx:6:17`.
- Kiểm thử editor dùng jsdom/data router thật, xác nhận giữ draft khi hủy đóng/điều hướng, bảo vệ lần mở tiếp theo và beforeunload. Chưa thử tương tác bằng trình duyệt thật hoặc staging hosting.

Mục 6 trong yêu cầu người dùng đang để trống; không tự bổ sung phạm vi ngoài các vấn đề được nêu.
