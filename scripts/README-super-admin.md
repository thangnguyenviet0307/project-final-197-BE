# Hướng dẫn Super Admin, Admin và Staff

Role trong API/DB: `super_admin`, `admin`, `staff`. Customer tiếp tục thuộc collection/tài khoản riêng.

| Chức năng hiện có | Super Admin | Admin | Staff |
| --- | --- | --- | --- |
| Quản lý sản phẩm, giá, danh mục, thương hiệu, Hero, đánh giá | Toàn quyền | Toàn quyền | Đọc; chỉ sửa tồn qua endpoint inventory |
| Khách hàng | Xem/sửa/khóa/xóa theo ràng buộc | Như Super Admin | Chỉ đọc |
| Đơn hàng | Tạo, phân công, xử lý mọi đơn hợp lệ | Như Super Admin | Tạo, nhận; xử lý đơn được giao |
| Tạo Admin / thay đổi Admin ↔ Staff | Có | Không | Không |
| Tạo Staff | Có | Có | Không |
| Sửa, khóa, reset mật khẩu, thu hồi phiên, xóa tài khoản | Admin và Staff | Chỉ Staff | Không |
| Sửa/khóa/xóa/reset Super Admin qua `/users` | Không | Không | Không |
| Hồ sơ, mật khẩu bản thân | Qua API hồ sơ/mật khẩu riêng | Như Super Admin | Như Super Admin |
| Chuyển quyền sở hữu | Có, xác thực lại mật khẩu | Không | Không |

Toàn quyền vẫn phải tuân thủ lịch sử đơn, tồn kho, lý do từ chối, optimistic concurrency và các ràng buộc dữ liệu. Không bổ sung CMS, thanh toán online hoặc trang cấu hình chưa có trong phạm vi thay đổi role này.

## Hệ thống mới

Endpoint bootstrap hiện có `POST /api/v1/auth/bootstrap`, được bảo vệ bằng `BOOTSTRAP_SECRET`, tạo Super Admin đầu tiên. Không có mật khẩu/credential mặc định mới. Không tạo tài khoản tự động chỉ bằng việc chạy server.

Bootstrap kiểm tra tài khoản quản trị hiện có và tạo singleton `admin-bootstrap` trong transaction. Hai request bootstrap không được tạo hai chủ sở hữu; singleton được giữ lại kể cả khi dữ liệu tài khoản bị xóa ngoài ứng dụng. Chạy lại server không nâng quyền bất kỳ tài khoản nào.

API tạo/sửa user thông thường chỉ nhận role Admin/Staff; Super Admin chỉ xuất hiện qua bootstrap, migration được xác nhận hoặc chuyển quyền sở hữu. Không cần thêm một unique index role gây cản trở việc chuyển cùng giá trị duy nhất giữa hai document trong transaction; các đường ghi quyền sở hữu được kiểm soát bởi bootstrap singleton hoặc khóa relations trong transaction.

## Hệ thống đang có dữ liệu

Không tự nâng quyền theo email hay thứ tự trả về của DB. Dừng các thao tác ghi, sao lưu, xem tài khoản quản trị có `createdAt` sớm nhất (tie-break `_id`) và xác nhận ID trước khi áp dụng. Script không đọc/ghi Customer hoặc đơn hàng và không in password/token/URI.

Chạy từ BE, với `MONGODB_URI` được cấu hình cho đúng môi trường:

```powershell
# Chỉ kiểm tra; chưa ghi dữ liệu.
pnpm.cmd exec node scripts/promote-first-super-admin.mjs --user-id <ID_DA_XAC_NHAN>

# Chỉ chạy sau khi đã review dry-run, sao lưu và cho phép thay đổi DB.
pnpm.cmd exec node scripts/promote-first-super-admin.mjs --user-id <ID_DA_XAC_NHAN> --apply
```

Script yêu cầu đúng ID đầu tiên, timestamp hợp lệ, tài khoản chưa bị khóa và chưa tồn tại Super Admin. Chế độ apply kiểm tra lại trong transaction, khóa cùng document `system_locks/relations`, nâng một tài khoản, thu hồi phiên của tài khoản đó. Nếu đã có Super Admin, script từ chối; dùng chức năng chuyển quyền thay vì chạy lại.

## Chuyển quyền và thu hồi phiên

`POST /api/v1/users/transfer-ownership` nhận `{ targetUserId, currentPassword }`. Chỉ Super Admin được gọi. Đích phải là Admin/Staff đang hoạt động và đã đổi mật khẩu tạm. Mật khẩu hiện tại được xác minh; source vẫn phải là chủ sở hữu với cùng password tại lúc ghi. Cả hai thay đổi role và thu hồi phiên chạy trong một transaction có khóa relations. Nếu đích không hợp lệ, source không bị hạ quyền do transaction rollback. Chủ cũ trở thành Admin; chủ mới trở thành Super Admin. Cả hai phải đăng nhập lại.

`POST /api/v1/users/:id/revoke-sessions` thu hồi access/refresh qua tokenVersion/refreshToken, tuân thủ cùng phân cấp quản lý tài khoản; không đổi mật khẩu.

FE có thao tác chuyển quyền và thu hồi phiên tại menu của tài khoản đủ điều kiện. Không có dropdown chọn Super Admin khi tạo/sửa user.

## Kiểm tra trước triển khai

- Deploy BE/FE tương thích cùng role mới; đăng nhập, refresh, menu, route và thao tác đầy đủ với cả ba role.
- Admin giả mạo role Super Admin, reset/khóa/xóa Admin hoặc chủ sở hữu phải bị chặn tại BE.
- Thử chuyển quyền sai mật khẩu, đích bị khóa/chưa đổi mật khẩu tạm, hai lần chuyển đồng thời; luôn còn đúng một chủ sở hữu khi dữ liệu đầu vào có đúng một chủ sở hữu.
- Chạy `pnpm.cmd typecheck`, `pnpm.cmd test`; integration chỉ chạy trên replica set test riêng qua `MONGODB_TEST_URI`. Test mock không chứng minh rollback/isolation MongoDB thực.

Không có migration hay thay đổi dữ liệu thực nào được chạy như một phần của việc viết code này.
