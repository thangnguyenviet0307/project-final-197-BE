# TÀI LIỆU ĐẶC TẢ FRONTEND DASHBOARD (ADMIN)

## I. Danh sách các trang (Pages List)

| STT | Page | Route | Role |
| :---: | :--- | :--- | :--- |
| 1 | Dashboard tổng quan | `/dashboard` | Admin |
| 2 | Đăng nhập | `/login` | Admin |
| 3 | Quản lý thương hiệu | `/brands` | Admin |
| 4 | Quản lý danh mục | `/categories` | Admin |
| 5 | Quản lý sản phẩm | `/products` | Admin |
| 6 | Quản lý đơn hàng | `/orders` | Admin |
| 7 | Quản lý người dùng | `/users` | Admin |
| 8 | Hồ sơ cá nhân | `/profile` | Admin |

---

## II. Đặc tả chi tiết từng trang

---

### 1. Dashboard tổng quan

| Hạng mục | Nội dung |
| :--- | :--- |
| **Route** | `/dashboard` |
| **Role truy cập** | Admin |
| **Mục đích** | Cung cấp cái nhìn tổng quan về tình hình kinh doanh, doanh thu, đơn hàng và các cảnh báo hoạt động của hệ thống. |

**Thành phần giao diện cần code**
* Thẻ thống kê (Cards): Tổng doanh thu, Số đơn hàng mới, Số lượng sản phẩm đang bán, Tổng số người dùng.
* Biểu đồ doanh thu (Line/Bar chart: theo tuần, tháng, năm).
* Biểu đồ tròn (Pie chart): Tỷ lệ đơn hàng theo trạng thái (Pending, Shipping, Completed, Cancelled).
* Bảng danh sách đơn hàng gần đây (Recent Orders mini-table).
* Danh sách sản phẩm bán chạy (Top selling products).
* Bộ lọc thời gian (Hôm nay, 7 ngày qua, Tháng này, Năm nay).

**Dữ liệu/Form field**

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
| :--- | :--- | :--- | :--- |
| `timeRange` | String | Không | `today`, `last_7_days`, `this_month`, `this_year` |
| `startDate` | Date | Không | Định dạng `YYYY-MM-DD` khi chọn tùy chỉnh |
| `endDate` | Date | Không | Định dạng `YYYY-MM-DD` |

**Hành động trên trang**

| Action | Mô tả |
| :--- | :--- |
| Đổi bộ lọc thời gian | Gửi query params để fetch lại dữ liệu thống kê |
| Chuyển hướng nhanh | Bấm vào card/đơn hàng để chuyển đến trang quản lý tương ứng |

**API cần dùng**

| Method | Endpoint | Mục đích |
| :--- | :--- | :--- |
| GET | `/api/dashboard/stats` | Lấy dữ liệu 4 thẻ KPIs tổng hợp |
| GET | `/api/dashboard/revenue-chart` | Lấy dữ liệu biểu đồ doanh thu |
| GET | `/api/dashboard/recent-orders` | Lấy danh sách 5–10 đơn hàng mới nhất |

**Database liên quan**
* `orders`
* `products`
* `users`

**Frontend cần code**
* Tích hợp thư viện biểu đồ (Recharts, Chart.js).
* Skeleton loading khi đang fetching dữ liệu.

**Backend/API cần chuẩn bị**
* Viết aggregation pipeline tính tổng doanh thu theo thời gian và gom nhóm trạng thái đơn hàng.

---

### 2. Đăng nhập

| Hạng mục | Nội dung |
| :--- | :--- |
| **Route** | `/login` |
| **Role truy cập** | Admin |
| **Mục đích** | Xác thực tài khoản quản trị viên để cấp quyền truy cập vào dashboard. |

**Thành phần giao diện cần code**
* Input Email / Username.
* Input Password (kèm nút ẩn/hiện mật khẩu).
* Checkbox "Ghi nhớ đăng nhập" (Remember me).
* Nút "Đăng nhập".
* Thông báo lỗi (Alert message).
* Hiệu ứng loading trên nút đăng nhập khi đang gửi request.

**Dữ liệu/Form field**

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
| :--- | :--- | :--- | :--- |
| `email` | String | Bắt buộc | Đúng định dạng email hợp lệ |
| `password` | String | Bắt buộc | Tối thiểu 6 ký tự |
| `rememberMe` | Boolean | Không | Mặc định: `false` |

**Hành động trên trang**

| Action | Mô tả |
| :--- | :--- |
| Đăng nhập | Submit form, gửi thông tin xác thực lên server |

**API cần dùng**

| Method | Endpoint | Mục đích |
| :--- | :--- | :--- |
| POST | `/api/auth/login` | Đăng nhập hệ thống, nhận JWT access token |

**Database liên quan**
* `users`
* `roles`

**Frontend cần code**
* Xử lý form validation (React Hook Form + Zod).
* Lưu token và user info vào LocalStorage / Cookie.
* Điều hướng về `/dashboard` sau khi đăng nhập thành công.
* Route Guard ngăn user chưa đăng nhập truy cập các route nội bộ.

**Backend/API cần chuẩn bị**
* Kiểm tra email, so khớp mật khẩu bằng `bcrypt`.
* Kiểm tra role người dùng có phải là Admin hay không.
* Sinh JWT access token và refresh token.

---

### 3. Quản lý thương hiệu

| Hạng mục | Nội dung |
| :--- | :--- |
| **Route** | `/brands` |
| **Role truy cập** | Admin |
| **Mục đích** | Quản lý danh sách các thương hiệu/hãng sản xuất của sản phẩm trong cửa hàng. |

**Thành phần giao diện cần code**
* Bảng danh sách thương hiệu (Logo, Tên thương hiệu, Slug, Mô tả ngắn, Số lượng sản phẩm, Trạng thái).
* Nút "Thêm thương hiệu mới" mở Modal/Drawer.
* Ô tìm kiếm thương hiệu theo tên.
* Bộ lọc trạng thái (Active, Inactive).
* Nút Thao tác: Sửa, Xóa (kèm Popconfirm xác nhận).

**Dữ liệu/Form field (Tạo/Sửa)**

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
| :--- | :--- | :--- | :--- |
| `name` | String | Bắt buộc | 2 - 50 ký tự, duy nhất |
| `slug` | String | Bắt buộc | Tự động tạo từ name hoặc tùy chỉnh |
| `logo` | File/URL | Không | Định dạng png, jpg, webp (Tối đa 2MB) |
| `description` | String | Không | Tối đa 500 ký tự |
| `isActive` | Boolean | Không | Mặc định: `true` |

**Hành động trên trang**

| Action | Mô tả |
| :--- | :--- |
| Tạo thương hiệu | Mở modal, nhập form và gửi API tạo mới |
| Cập nhật thương hiệu | Sửa thông tin thương hiệu trực tiếp trên modal |
| Xóa thương hiệu | Xóa thương hiệu (chỉ cho phép khi không có sản phẩm liên kết) |

**API cần dùng**

| Method | Endpoint | Mục đích |
| :--- | :--- | :--- |
| GET | `/api/brands` | Lấy danh sách thương hiệu kèm tìm kiếm/phân trang |
| POST | `/api/brands` | Tạo mới thương hiệu |
| PUT | `/api/brands/:id` | Cập nhật thông tin thương hiệu |
| DELETE | `/api/brands/:id` | Xóa thương hiệu |

**Database liên quan**
* `brands`
* `products`

**Frontend cần code**
* Preview ảnh logo khi upload.
* Auto-generate slug theo tiếng Việt không dấu.
* Modal CRUD tái sử dụng cho cả Create và Edit.

**Backend/API cần chuẩn bị**
* Xử lý upload ảnh lên Cloudinary/S3.
* Ràng buộc dữ liệu: Không cho phép xóa nếu có sản phẩm tham chiếu đến thương hiệu.

---

### 4. Quản lý danh mục

| Hạng mục | Nội dung |
| :--- | :--- |
| **Route** | `/categories` |
| **Role truy cập** | Admin |
| **Mục đích** | Quản lý cây phân cấp danh mục sản phẩm (Category Tree: Danh mục cha - con). |

**Thành phần giao diện cần code**
* Chế độ hiển thị: Dạng bảng phân cấp (Tree Table) hoặc danh sách lồng nhau.
* Cột hiển thị: Tên danh mục, Ảnh đại diện, Danh mục cha, Số sản phẩm, Thứ tự hiển thị, Trạng thái.
* Nút "Thêm danh mục mới".
* Modal tạo/sửa danh mục.
* Bộ lọc trạng thái hoạt động.

**Dữ liệu/Form field (Tạo/Sửa)**

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
| :--- | :--- | :--- | :--- |
| `name` | String | Bắt buộc | 2 - 100 ký tự |
| `slug` | String | Bắt buộc | Định dạng URL-friendly |
| `parentId` | String/ObjectId | Không | Chọn danh mục cha (để trống nếu là danh mục gốc) |
| `image` | File/URL | Không | Ảnh đại diện danh mục |
| `sortOrder` | Number | Không | Thứ tự ưu tiên hiển thị (Mặc định: 0) |
| `isActive` | Boolean | Không | Mặc định: `true` |

**Hành động trên trang**

| Action | Mô tả |
| :--- | :--- |
| Thêm mới danh mục | Mở form thêm mới danh mục cha hoặc con |
| Sắp xếp thứ tự | Điều chỉnh số thứ tự hiển thị |
| Bật/tắt trạng thái | Cập nhật nhanh trạng thái Active/Inactive qua Switch toggle |
| Xóa danh mục | Xóa danh mục (xử lý logic danh mục con đi kèm) |

**API cần dùng**

| Method | Endpoint | Mục đích |
| :--- | :--- | :--- |
| GET | `/api/categories` | Lấy cây danh mục sản phẩm |
| POST | `/api/categories` | Tạo mới danh mục |
| PUT | `/api/categories/:id` | Cập nhật danh mục |
| DELETE | `/api/categories/:id` | Xóa danh mục |

**Database liên quan**
* `categories`
* `products`

**Frontend cần code**
* Dropdown Select hỗ trợ phân cấp (TreeSelect) để chọn danh mục cha.
* Switch component để toggle trạng thái trực tiếp trên dòng.

**Backend/API cần chuẩn bị**
* Xử lý logic đệ quy trả về cấu trúc lồng nhau (Nested/Tree format).
* Ngăn chặn việc chọn chính danh mục đó hoặc con của nó làm cha.

---

### 5. Quản lý sản phẩm

| Hạng mục | Nội dung |
| :--- | :--- |
| **Route** | `/products` |
| **Role truy cập** | Admin |
| **Mục đích** | Quản lý danh sách toàn bộ sản phẩm: thêm mới, sửa giá, tồn kho, hình ảnh, biến thể và trạng thái đăng bán. |

**Thành phần giao diện cần code**
* Bảng danh sách sản phẩm (Ảnh thumbnail, Tên sản phẩm, Mã SKU, Danh mục, Thương hiệu, Giá gốc, Giá khuyến mãi, Tồn kho, Trạng thái).
* Nút "Thêm sản phẩm mới" (mở trang riêng `/products/create` hoặc Drawer lớn).
* Bộ lọc đa năng: Theo danh mục, thương hiệu, trạng thái tồn kho (Hết hàng, Còn hàng), khoảng giá.
* Ô tìm kiếm theo tên sản phẩm, SKU.
* Phân trang và chức năng Xóa hàng loạt (Bulk actions).

**Dữ liệu/Form field (Tạo/Sửa sản phẩm)**

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
| :--- | :--- | :--- | :--- |
| `name` | String | Bắt buộc | Tên sản phẩm (5 - 200 ký tự) |
| `sku` | String | Bắt buộc | Mã sản phẩm duy nhất |
| `categoryId` | String/ObjectId | Bắt buộc | Chọn danh mục hợp lệ |
| `brandId` | String/ObjectId | Bắt buộc | Chọn thương hiệu hợp lệ |
| `price` | Number | Bắt buộc | Giá niêm yết (>= 0) |
| `discountPrice` | Number | Không | Phải nhỏ hơn `price` |
| `stock` | Number | Bắt buộc | Số lượng tồn kho (>= 0) |
| `images` | Array[File/URL] | Bắt buộc | Tối thiểu 1 ảnh chính |
| `description` | String (HTML) | Không | Nội dung mô tả chi tiết (Rich Text) |
| `status` | String | Bắt buộc | `draft`, `published`, `out_of_stock` |

**Hành động trên trang**

| Action | Mô tả |
| :--- | :--- |
| Tạo sản phẩm mới | Nhập form thông tin chi tiết, upload nhiều ảnh, cấu hình giá/kho |
| Cập nhật nhanh tồn kho/giá | Chỉnh sửa inline trực tiếp trên bảng |
| Ẩn/Hiện sản phẩm | Chuyển đổi trạng thái đăng bán |
| Xóa sản phẩm | Chuyển vào thùng rác (Soft delete) |

**API cần dùng**

| Method | Endpoint | Mục đích |
| :--- | :--- | :--- |
| GET | `/api/products` | Lấy danh sách sản phẩm (lọc, sort, phân trang) |
| POST | `/api/products` | Thêm mới sản phẩm |
| GET | `/api/products/:id` | Lấy chi tiết thông tin 1 sản phẩm |
| PUT | `/api/products/:id` | Cập nhật toàn bộ thông tin sản phẩm |
| DELETE | `/api/products/:id` | Xóa (soft delete) sản phẩm |

**Database liên quan**
* `products`
* `categories`
* `brands`

**Frontend cần code**
* Trình soạn thảo văn bản Rich Text Editor (Tiptap, Quill, CKEditor).
* Trình upload nhiều ảnh kéo thả và cho phép đổi vị trí ảnh chính.
* Debounce tìm kiếm theo từ khóa.

**Backend/API cần chuẩn bị**
* Text index hỗ trợ tìm kiếm theo tên và SKU.
* Populate trường `categoryId` và `brandId`.

---

### 6. Quản lý đơn hàng

| Hạng mục | Nội dung |
| :--- | :--- |
| **Route** | `/orders` |
| **Role truy cập** | Admin |
| **Mục đích** | Tiếp nhận, xử lý trạng thái đơn hàng, theo dõi quá trình giao nhận và thông tin thanh toán của khách. |

**Thành phần giao diện cần code**
* Thanh Tab phân loại trạng thái: Tất cả, Chờ xử lý (Pending), Đã xác nhận (Confirmed), Đang giao (Shipping), Hoàn thành (Delivered), Đã hủy (Cancelled).
* Bảng danh sách đơn hàng (Mã đơn, Tên khách hàng, SĐT, Ngày đặt, Phương thức thanh toán, Trạng thái thanh toán, Tổng tiền, Trạng thái vận chuyển).
* Drawer / Modal xem chi tiết đơn hàng:
  * Danh sách mặt hàng mua (Ảnh, Tên, Số lượng, Đơn giá).
  * Thông tin người nhận và địa chỉ giao hàng.
  * Lịch sử trạng thái đơn hàng (Timeline/Stepper).
* Dropdown chuyển đổi trạng thái đơn hàng nhanh.

**Dữ liệu/Form field (Cập nhật trạng thái)**

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
| :--- | :--- | :--- | :--- |
| `orderStatus` | String | Bắt buộc | `pending`, `confirmed`, `shipping`, `delivered`, `cancelled` |
| `paymentStatus`| String | Bắt buộc | `unpaid`, `paid`, `refunded` |
| `cancelReason` | String | Bắt buộc nếu hủy | Nhập lý do khi chuyển trạng thái `cancelled` |

**Hành động trên trang**

| Action | Mô tả |
| :--- | :--- |
| Lọc theo trạng thái | Bấm tab để hiển thị các đơn hàng cần xử lý |
| Cập nhật trạng thái | Đổi tiến trình đơn hàng (tự động validate luồng) |
| In hóa đơn | Mở cửa sổ in phiếu giao hàng/hóa đơn |

**API cần dùng**

| Method | Endpoint | Mục đích |
| :--- | :--- | :--- |
| GET | `/api/orders` | Lấy danh sách đơn hàng (kèm lọc theo status, ngày) |
| GET | `/api/orders/:id` | Lấy thông tin chi tiết một đơn hàng |
| PATCH | `/api/orders/:id/status` | Cập nhật trạng thái xử lý đơn hàng |

**Database liên quan**
* `orders`
* `order_items`
* `users`
* `products`

**Frontend cần code**
* Modal chi tiết đơn hàng dạng 2 cột: Cột sản phẩm/thanh toán & Cột thông tin giao hàng/timeline.
* Giao diện in ấn (Print CSS) cho hóa đơn bán lẻ.

**Backend/API cần chuẩn bị**
* Xử lý hoàn lại số lượng tồn kho (`stock`) của sản phẩm khi đơn hàng chuyển sang `cancelled`.
* Validate chặt chẽ quy trình chuyển trạng thái (ví dụ: Không thể chuyển từ `cancelled` về `delivered`).

---

### 7. Quản lý người dùng

| Hạng mục | Nội dung |
| :--- | :--- |
| **Route** | `/users` |
| **Role truy cập** | Admin |
| **Mục đích** | Quản lý danh sách tài khoản khách hàng, lịch sử mua sắm và trạng thái hoạt động tài khoản. |

**Thành phần giao diện cần code**
* Bảng danh sách người dùng (Avatar, Họ tên, Email, Số điện thoại, Số đơn đã mua, Tổng chi tiêu, Trạng thái, Ngày đăng ký).
* Thanh tìm kiếm theo tên, email hoặc SĐT.
* Bộ lọc theo trạng thái: Đang hoạt động (Active), Bị khóa (Banned).
* Modal xác nhận khóa / mở khóa tài khoản người dùng kèm ô nhập lý do.
* Drawer xem lịch sử đơn hàng của người dùng được chọn.

**Dữ liệu/Form field**

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
| :--- | :--- | :--- | :--- |
| `keyword` | String | Không | Tìm kiếm theo họ tên, email, SĐT |
| `status` | String | Không | `all`, `active`, `banned` |
| `banReason` | String | Bắt buộc khi khóa | Lý do khóa tài khoản |

**Hành động trên trang**

| Action | Mô tả |
| :--- | :--- |
| Tìm kiếm & Lọc | Lọc danh sách theo thông tin khách hàng |
| Khóa/Mở tài khoản | Thay đổi trạng thái tài khoản người dùng |
| Xem lịch sử mua sắm | Xem các đơn hàng gắn liền với người dùng đó |

**API cần dùng**

| Method | Endpoint | Mục đích |
| :--- | :--- | :--- |
| GET | `/api/users` | Lấy danh sách người dùng (kèm phân trang, lọc) |
| GET | `/api/users/:id/orders` | Lấy lịch sử mua hàng của người dùng |
| PATCH | `/api/users/:id/status` | Khóa hoặc kích hoạt lại tài khoản |

**Database liên quan**
* `users`
* `orders`

**Frontend cần code**
* Dialog xác nhận khóa tài khoản có cảnh báo nguy hiểm.
* Format định dạng tiền tệ cho cột "Tổng chi tiêu".

**Backend/API cần chuẩn bị**
* Viết lookup/aggregate tính toán số đơn hàng và tổng tiền đã chi của từng user.
* Vô hiệu hóa JWT token khi người dùng bị chuyển sang trạng thái `banned`.

---

### 8. Hồ sơ cá nhân

| Hạng mục | Nội dung |
| :--- | :--- |
| **Route** | `/profile` |
| **Role truy cập** | Admin |
| **Mục đích** | Quản lý thông tin cá nhân của quản trị viên, cập nhật ảnh đại diện và thay đổi mật khẩu đăng nhập. |

**Thành phần giao diện cần code**
* Khối thông tin tài khoản: Avatar lớn kèm nút đổi ảnh, Họ tên, Email (Read-only), Vai trò (Badge Admin).
* Form 1: Cập nhật thông tin cá nhân (Họ tên, Số điện thoại).
* Form 2: Đổi mật khẩu (Mật khẩu hiện tại, Mật khẩu mới, Xác nhận mật khẩu mới).
* Thông báo toast thành công/thất bại.

**Dữ liệu/Form field**

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
| :--- | :--- | :--- | :--- |
| `fullName` | String | Bắt buộc | 2 - 50 ký tự |
| `phoneNumber` | String | Không | Đúng định dạng SĐT |
| `avatar` | File/URL | Không | Tối đa 5MB, định dạng ảnh |
| `currentPassword`| String | Bắt buộc (khi đổi pass) | Tối thiểu 6 ký tự |
| `newPassword` | String | Bắt buộc (khi đổi pass) | Tối thiểu 8 ký tự, có ký tự số |
| `confirmPassword`| String | Bắt buộc (khi đổi pass) | Phải trùng khớp với `newPassword` |

**Hành động trên trang**

| Action | Mô tả |
| :--- | :--- |
| Cập nhật thông tin | Gửi thông tin họ tên, SĐT, avatar mới |
| Đổi mật khẩu | Gửi request đổi mật khẩu xác thực mật khẩu cũ |

**API cần dùng**

| Method | Endpoint | Mục đích |
| :--- | :--- | :--- |
| GET | `/api/profile/me` | Lấy thông tin chi tiết admin đang đăng nhập |
| PUT | `/api/profile/me` | Cập nhật thông tin cá nhân & avatar |
| POST | `/api/profile/change-password` | Thực hiện đổi mật khẩu tài khoản |

**Database liên quan**
* `users`

**Frontend cần code**
* Preview ảnh avatar ngay sau khi người dùng chọn file từ máy.
* Validate client: mật khẩu mới không được trùng mật khẩu cũ, confirm password phải khớp.
* Tự động đồng bộ tên/avatar trên Top Navbar Header sau khi lưu thành công.

**Backend/API cần chuẩn bị**
* Dùng `bcrypt.compare` kiểm tra tính chính xác của mật khẩu hiện tại.
* Hash mật khẩu mới trước khi lưu xuống cơ sở dữ liệu.