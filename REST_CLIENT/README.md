# Test API bằng VS Code REST Client

REST Client chỉ chia sẻ biến response trong cùng một file. Proxy local đi kèm lưu session vào `REST_CLIENT/.env` (được Git bỏ qua). Request cần đăng nhập có header tiêu chuẩn `Authorization: Bearer {{$dotenv ACCESS_TOKEN}}` (hoặc `STAFF_ACCESS_TOKEN`) và header `x-rest-client-auth: primary`/`staff`. Khi đi qua proxy, token được đọc lại từ `.env` để gửi giá trị mới nhất; backend vẫn chỉ xác thực bằng `Authorization`. Không dùng riêng `x-rest-client-auth` để gọi backend trực tiếp. Các file `.http` không chứa token hardcode.

## Khởi chạy

1. Terminal 1: `pnpm.cmd dev` — backend ở cổng 5000.
2. Terminal 2: `pnpm.cmd rest-client` — proxy chỉ lắng nghe `127.0.0.1:5001`, chuyển request tới backend local. Nếu backend dùng cổng khác, đặt biến môi trường `REST_CLIENT_TARGET_URL` trước khi chạy proxy. Dừng proxy cũ bằng Ctrl+C trước khi chạy bản mới; log khởi động phải có **REST Client proxy v3**. Chế độ watch tự khởi động lại khi code proxy thay đổi, không khởi động lại khi token trong `.env` thay đổi.
3. Điền tài khoản vào `LOGIN_EMAIL`, `LOGIN_PASSWORD` trong `REST_CLIENT/.env`. Các giá trị login đang có trong `auth.http` đã được chuyển vào file này. Máy mới có thể tham khảo `.env.example` trong thư mục này.
4. Gửi request **login** trong `auth.http`. Chỉ khi response thành công, proxy tự ghi `ACCESS_TOKEN`, `REFRESH_TOKEN`, `USER_ID` vào `.env` trước khi trả response cho editor.
5. Chuyển sang bất kỳ file `.http` nào và gửi request. Không cần đăng nhập lại ở từng file hoặc sao chép token. Proxy chỉ thêm authentication khi request có `x-rest-client-auth`; các request test thiếu token vẫn trả 401 như bình thường. Header này được loại bỏ trước khi gửi đến backend.

Các file `.http` dùng cổng **5001**; ứng dụng frontend vẫn dùng backend cổng **5000**. Proxy chỉ phục vụ test local, không thay đổi API và không gọi request thay bạn.

## Refresh, logout và staff

- Access token hết hạn: gửi **refresh** trong `auth.http`; cả hai token dùng chung được cập nhật tự động. Refresh không tự chạy ngầm; nếu refresh token cũng hết hạn, đăng nhập lại.
- **logout** thành công sẽ xóa token dùng chung.
- Test quyền staff: tạo tài khoản ở `user.http`, hoặc cấu hình tài khoản staff có sẵn trong `STAFF_LOGIN_EMAIL`, `STAFF_LOGIN_PASSWORD`. Gửi **staffLogin** trong `auth.http`; request có `x-rest-client-session: staff` để lưu `STAFF_ACCESS_TOKEN`/`STAFF_REFRESH_TOKEN` riêng, giữ nguyên session chính.
- Chỉ dùng hai tài khoản khác nhau cho session chính và staff vì backend chỉ lưu một refresh session trên mỗi tài khoản.
- Request thất bại không ghi đè session đang dùng. Proxy không ghi log token hoặc mật khẩu.

## Dữ liệu test và ID

Thứ tự thuận tiện: tạo brand → category → product → customer → order. Proxy tự ghi các ID thành công vào `BRAND_ID`, `CATEGORY_ID`, `PRODUCT_ID`, `VARIANT_ID` (biến thể đầu tiên), `CUSTOMER_ID`, `ORDER_ID`; tạo user staff cập nhật `STAFF_USER_ID`. Customer 2/3 có ID riêng để không ghi đè customer chính. Nếu dùng dữ liệu có sẵn, lấy `_id` của bản ghi bạn muốn test từ Get All rồi điền vào biến tương ứng trong `.env`.

Các biến ID trong `.http` dùng placeholder như `__BRAND_ID__`; proxy thay bằng ID mới nhất từ `.env` trong URL/query/body. Không thay các placeholder này bằng chuỗi rỗng. Thiếu ID sẽ trả **400 kèm tên biến cần điền**, thay vì âm thầm gọi Get All. Đăng nhập và Get All không tự chọn một bản ghi bất kỳ để tránh các request update/delete tác động nhầm dữ liệu.

Các bước update/delete và test lỗi phải được gửi riêng, theo trạng thái hiện tại. Đơn Completed không thể hủy; muốn test hoàn kho, tạo đơn mới rồi chuyển Rejected. Sản phẩm đã có đơn hàng không thể xóa. Chỉ chạy request xóa trên dữ liệu test của bạn; không dùng Send All Requests trên dữ liệu thật.

Riêng `customer.http`, URL chi tiết/update/delete đọc ID trực tiếp bằng `{{$dotenv CUSTOMER_ID}}`, `CUSTOMER_2_ID`, `CUSTOMER_3_ID`, không gửi placeholder `__CUSTOMER_ID__` tới backend. Update chính dùng CUSTOMER_ID; deactivate dùng CUSTOMER_2_ID; delete dùng CUSTOMER_3_ID. Chạy request tạo customer tương ứng trước, hoặc điền chính xác `_id` của dữ liệu test đã có vào đúng biến. Không sao chép CUSTOMER_ID vào cả ba biến nếu bạn không muốn sửa/xóa cùng một khách hàng.

## Kiểm tra proxy đang chạy

Response qua proxy mới luôn có header `x-rest-client-proxy-version: 3`. Nếu không có header này, dừng tiến trình proxy cũ và chạy lại `pnpm.cmd rest-client`; lưu các file `.http` đang mở trước khi gửi request. Backend không cần thay đổi logic xác thực để dùng proxy mới. Nếu access token hết hạn, chạy refresh hoặc login trong `auth.http`.

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

Trong `order.http`, chạy **checkOrderEndpoint** trước: body `{}` phải trả **400 Validation failed**, xác nhận POST đã khớp route và chưa tạo dữ liệu. Nếu vẫn trả `404 Not Found`, request chưa đến đúng endpoint/backend; dùng Send Request tại dòng POST đầy đủ trong file, kiểm tra cổng `5001`, header proxy v3 và khởi động backend từ đúng thư mục dự án. Không thêm `/create`, `/orders` lần nữa hoặc ID vào URL tạo đơn. POST nhầm `/orders/create` hoặc `/orders/:id` giờ trả 405 kèm URL đúng.

Sau đó chọn customer đang hoạt động, product đang bán và variant thuộc product đó, kiểm tra còn hàng. Điền ID trong `REST_CLIENT/.env`; đăng nhập sẽ tự điền USER_ID. Tạo đơn thành công trả **201**, lưu ORDER_ID, lấy giá từ server và trừ kho trong transaction. Luồng hợp lệ là `Pending (1) → Processing (2) → Completed (4)`, hoặc `Pending/Processing → Rejected (3)` để hoàn kho. Muốn thử hủy sau khi đã Completed, hãy tạo đơn mới. Chỉ xóa đơn đã Rejected. MongoDB phải hỗ trợ transaction.
