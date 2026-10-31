# Test API bằng VS Code REST Client

REST Client chỉ chia sẻ biến response trong cùng một file. Proxy local đi kèm lưu session vào `REST_CLIENT/.env` (được Git bỏ qua). Request cần đăng nhập có header tiêu chuẩn `Authorization: Bearer {{$dotenv ACCESS_TOKEN}}` (hoặc `STAFF_ACCESS_TOKEN`) và header `x-rest-client-auth: primary`/`staff`. Khi đi qua proxy, token được đọc lại từ `.env` để gửi giá trị mới nhất; backend vẫn chỉ xác thực bằng `Authorization`. Không dùng riêng `x-rest-client-auth` để gọi backend trực tiếp. Các file `.http` không chứa token hardcode.

## Khởi chạy

1. Cấu hình MongoDB trong `.env` ở thư mục gốc Backend bằng `MONGODB_URI`. Dùng database riêng cho kiểm thử; MongoDB phải là Atlas, replica set hoặc sharded cluster vì backend yêu cầu transaction. Không dùng production database.
2. Tạo `.env` ở thư mục gốc từ `.env.example` và điền `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (hai khóa khác nhau) và các biến cần thiết. `BOOTSTRAP_SECRET` chỉ cần khi tạo Admin đầu tiên. Không commit/chia sẻ file `.env`.
3. Terminal 1: `pnpm.cmd dev` — server kiểm tra kết nối database trước khi mở cổng 5000. Chỉ tiếp tục khi log có `MongoDB connected successfully` và `Server running`.
4. Sao chép `REST_CLIENT/.env.example` thành `REST_CLIENT/.env`, rồi điền `LOGIN_EMAIL`, `LOGIN_PASSWORD` của tài khoản Admin trên database test. `REST_CLIENT/.env` lưu phiên test riêng, không dùng để cấu hình MongoDB.
5. Terminal 2: `pnpm.cmd rest-client` — proxy chỉ lắng nghe `127.0.0.1:5001`, chuyển request tới backend local. Nếu backend dùng cổng khác, đặt biến môi trường `REST_CLIENT_TARGET_URL` trước khi chạy proxy. Dừng proxy cũ bằng Ctrl+C trước khi chạy bản mới; log khởi động phải có **REST Client proxy v4**. Chế độ watch tự khởi động lại khi code proxy thay đổi, không khởi động lại khi token trong `.env` thay đổi.
6. Gửi request **login** trong `auth.http`. Chỉ khi response thành công, proxy tự ghi `ACCESS_TOKEN`, `REFRESH_TOKEN`, `USER_ID` vào `REST_CLIENT/.env` trước khi trả response cho editor.
7. Chuyển sang file `.http` cần test. Không cần đăng nhập lại ở từng file hoặc sao chép token. Proxy chỉ thêm authentication khi request có `x-rest-client-auth`; các request test thiếu token vẫn trả 401 như bình thường. Header này được loại bỏ trước khi gửi đến backend.

Với MongoDB local dạng replica set, URI có thể dùng dạng
`mongodb://127.0.0.1:27017/project_final_197_test?replicaSet=rs0`.
Replica set `rs0` phải được khởi tạo và đang chạy trước `pnpm.cmd dev`.

Các file `.http` dùng cổng **5001**; ứng dụng frontend vẫn dùng backend cổng **5000**. Proxy chỉ phục vụ test local, không thay đổi API và không gọi request thay bạn.

## Refresh, logout và staff

- Access token hết hạn: gửi **refresh** trong `auth.http`; cả hai token dùng chung được cập nhật tự động. Refresh không tự chạy ngầm; nếu refresh token cũng hết hạn, đăng nhập lại.
- **logout** thành công sẽ xóa token dùng chung.
- Test quyền staff: tạo tài khoản ở `users.http`, hoặc cấu hình tài khoản staff có sẵn trong `STAFF_LOGIN_EMAIL`, `STAFF_LOGIN_PASSWORD`. Gửi **staffLogin** trong `auth.http`; request có `x-rest-client-session: staff` để lưu `STAFF_ACCESS_TOKEN`/`STAFF_REFRESH_TOKEN` riêng, giữ nguyên session chính.
- Chỉ dùng hai tài khoản khác nhau cho session chính và staff vì backend chỉ lưu một refresh session trên mỗi tài khoản.
- Request thất bại không ghi đè session đang dùng. Proxy không ghi log token hoặc mật khẩu.

## Dữ liệu test và ID

Thứ tự thuận tiện: tạo brand → category → product → customer → order. Proxy tự ghi các ID thành công vào `BRAND_ID`, `CATEGORY_ID`, `PRODUCT_ID`, `VARIANT_ID` (biến thể đầu tiên), `CUSTOMER_ID`, `ORDER_ID`; tạo user staff cập nhật `STAFF_USER_ID`. Customer 2/3 có ID riêng để không ghi đè customer chính. Nếu dùng dữ liệu có sẵn, lấy `_id` của bản ghi bạn muốn test từ Get All rồi điền vào biến tương ứng trong `.env`.

`articles.http` cần một tài khoản Admin. Gửi request **Create draft article** để proxy tự lưu `ARTICLE_ID` và `ARTICLE_SLUG`; ID được dùng ở các request quản trị, còn slug dùng để kiểm tra endpoint public sau khi xuất bản. Sau mỗi lần cập nhật, lấy `__v` mới từ response/GET detail và cập nhật `expectedVersion` ở request tiếp theo; version cũ trả `409`. Bài nháp không xuất hiện công khai cho đến khi chuyển status sang `published`. Chỉ gửi request Delete cho bài test.

All HTTP files read IDs through `{{$dotenv BRAND_ID}}` and corresponding entries in `.env`. The proxy retains support for old placeholders. Keep variable references so new resources update their selected IDs automatically; parent categories use PARENT_CATEGORY_ID separately.

Các bước update/delete và test lỗi phải được gửi riêng, theo trạng thái hiện tại. Đơn Completed không thể hủy; muốn test hoàn kho, tạo đơn mới rồi chuyển Rejected. Sản phẩm đã có đơn hàng không thể xóa. Chỉ chạy request xóa trên dữ liệu test của bạn; không dùng Send All Requests trên dữ liệu thật.

Riêng `customers.http`, URL chi tiết/update/delete đọc ID trực tiếp bằng `{{$dotenv CUSTOMER_ID}}`, `CUSTOMER_2_ID`, `CUSTOMER_3_ID`, không gửi placeholder `__CUSTOMER_ID__` tới backend. Update chính dùng CUSTOMER_ID; deactivate dùng CUSTOMER_2_ID; delete dùng CUSTOMER_3_ID. Chạy request tạo customer tương ứng trước, hoặc điền chính xác `_id` của dữ liệu test đã có vào đúng biến. Không sao chép CUSTOMER_ID vào cả ba biến nếu bạn không muốn sửa/xóa cùng một khách hàng.

## Kiểm tra proxy đang chạy

Response qua proxy mới luôn có header `x-rest-client-proxy-version: 4`. Nếu không có header này, dừng tiến trình proxy cũ và chạy lại `pnpm.cmd rest-client`; lưu các file `.http` đang mở trước khi gửi request. Backend không cần thay đổi logic xác thực để dùng proxy mới. Nếu access token hết hạn, chạy refresh hoặc login trong `auth.http`.

Nếu response báo `Token không được cung cấp` và không có header phiên bản proxy, hãy gửi lại bằng **Send Request ngay trên request đang mở**, không dùng Rerun Last Request (lệnh đó có thể gửi lại request cũ). URL trong các file mẫu phải trỏ đến cổng `5001`, backend chạy ở `5000`. Các request có tiêu đề `Unauthorized (no token)` hoặc `Missing authentication` cố tình không gửi token và phải trả 401.

Không chia sẻ hoặc commit `.env`; các file `.http` chỉ chứa tham chiếu tới token. Proxy không được khởi chạy cùng production server.

## Orders: endpoint và thứ tự test

| Phương thức | Đường dẫn | Chức năng |
| --- | --- | --- |
| POST | `/api/v1/orders` | Tạo đơn |
| GET | `/api/v1/orders` | Danh sách, phân trang/lọc |
| GET | `/api/v1/orders/:id` | Chi tiết đơn |
| PATCH | `/api/v1/orders/:id/status` | Đổi trạng thái |
| DELETE | `/api/v1/orders/:id` | Xóa đơn Rejected |

Trong `orders.http`, chạy **checkOrderEndpoint** trước: body `{}` phải trả **400 Validation failed**, xác nhận POST đã khớp route và chưa tạo dữ liệu. Nếu vẫn trả `404 Not Found`, request chưa đến đúng endpoint/backend; dùng Send Request tại dòng POST đầy đủ trong file, kiểm tra cổng `5001`, header proxy v4 và khởi động backend từ đúng thư mục dự án. Không thêm `/create`, `/orders` lần nữa hoặc ID vào URL tạo đơn. POST nhầm `/orders/create` hoặc `/orders/:id` giờ trả 405 kèm URL đúng.

Sau đó chọn customer đang hoạt động, product đang bán và variant thuộc product đó, kiểm tra còn hàng. Điền ID trong `REST_CLIENT/.env`; đăng nhập sẽ tự điền USER_ID. Tạo đơn thành công trả **201**, lưu ORDER_ID, lấy giá từ server và trừ kho trong transaction. Luồng hợp lệ là `Pending (1) → Processing (2) → Completed (4)`, hoặc `Pending/Processing → Rejected (3)` để hoàn kho. Muốn thử hủy sau khi đã Completed, hãy tạo đơn mới. Chỉ xóa đơn đã Rejected. MongoDB phải hỗ trợ transaction.


## Updated data rules

- Keep `{{$dotenv ...}}` references. Successful creation updates the shared ID. Never use Send All Requests on real data.
- Each completion/cancellation workflow in `orders.http` requires a new order. Creation updates ORDER_ID automatically. Completed/Rejected orders cannot transition again.
- PATCH `/orders/:id/assignee` changes the handler of an open order without changing its status.
- Deleting a customer/user/product referenced by orders, or a brand/category referenced by products, returns 409 to preserve relationships.
- PARENT_CATEGORY_ID must identify a parent different from CATEGORY_ID; creating a category does not overwrite the selected parent.
- Login/bootstrap/refresh exceed 30 attempts per 15 minutes from one IP returns 429; follow Retry-After.
