# Frontend Admin Dashboard --- Bản đơn giản cho đồ án

## 1. Mục tiêu

Xây dựng giao diện quản trị cho website bán phụ kiện điện thoại. Bản này
ưu tiên các chức năng cốt lõi, phù hợp để học React, kết nối REST API và
MongoDB. Phạm vi là một website bán hàng, một vai trò Admin, không làm
multi-vendor.

## 2. Công nghệ đề xuất

-   React + TypeScript (TSX), Vite
-   Tailwind CSS, shadcn/ui, Lucide React
-   React Router
-   TanStack Query, Axios
-   React Hook Form + Zod
-   Backend: Node.js + Express + TypeScript
-   Database: MongoDB + Mongoose
-   Package manager: pnpm

## 3. Danh sách trang

    STT Trang                 Route           Vai trò
  ----- --------------------- --------------- ---------
      1 Dashboard tổng quan   `/dashboard`    Admin
      2 Đăng nhập             `/login`        Admin
      3 Quản lý thương hiệu   `/brands`       Admin
      4 Quản lý danh mục      `/categories`   Admin
      5 Quản lý sản phẩm      `/products`     Admin
      6 Quản lý đơn hàng      `/orders`       Admin
      7 Quản lý người dùng    `/users`        Admin
      8 Hồ sơ cá nhân         `/profile`      Admin

## 4. Chức năng từng trang

### 4.1. Đăng nhập --- `/login`

-   Nhập email và mật khẩu, kiểm tra trường bắt buộc.
-   Gửi thông tin đăng nhập tới backend; hiển thị lỗi nếu thất bại.
-   Thành công thì chuyển tới `/dashboard`.
-   Có nút đăng xuất.
-   Chưa cần quên mật khẩu qua email, đăng nhập mạng xã hội hoặc xác
    thực hai lớp.

API: `POST /api/auth/login`, `GET /api/auth/me`. Có thể thêm
`POST /api/auth/logout` nếu backend cần.

### 4.2. Dashboard tổng quan --- `/dashboard`

-   Thẻ thống kê: tổng sản phẩm, tổng đơn hàng, tổng khách hàng, doanh
    thu.
-   Bảng 5 đơn hàng mới nhất: mã đơn, khách hàng, tổng tiền, trạng thái,
    ngày tạo.
-   Biểu đồ doanh thu theo 7 ngày hoặc 7 tháng là tùy chọn; có thể bỏ để
    tiết kiệm thời gian.

API: `GET /api/dashboard/overview`, `GET /api/orders?limit=5`. Thống
nhất quy tắc tính doanh thu ở backend, ví dụ chỉ tính đơn đã thanh toán
hoặc hoàn thành.

### 4.3. Quản lý thương hiệu --- `/brands`

Dữ liệu: tên thương hiệu, mô tả không bắt buộc, trạng thái hoạt
động/ngừng hoạt động.

Chức năng: xem danh sách, tìm theo tên, thêm, sửa, xóa sau khi xác nhận.
Chưa cần logo hoặc lịch sử chỉnh sửa.

API: `GET /api/brands`, `POST /api/brands`, `PATCH /api/brands/:id`,
`DELETE /api/brands/:id`.

### 4.4. Quản lý danh mục --- `/categories`

Dữ liệu: tên danh mục, mô tả không bắt buộc, trạng thái. Ví dụ: Cáp sạc,
Củ sạc, Ốp lưng, Tai nghe, Giá đỡ.

Chức năng: xem danh sách, tìm kiếm, thêm, sửa, xóa sau khi xác nhận.
Phiên bản đầu không cần danh mục cha/con.

API: `GET /api/categories`, `POST /api/categories`,
`PATCH /api/categories/:id`, `DELETE /api/categories/:id`.

### 4.5. Quản lý sản phẩm --- `/products`

Dữ liệu tối thiểu: - Tên sản phẩm - Danh mục và thương hiệu (thương hiệu
có thể không bắt buộc) - Giá bán và số lượng tồn kho - Một URL hình ảnh
(không bắt buộc) - Mô tả ngắn - Trạng thái đang bán/ngừng bán

Chức năng: xem bảng sản phẩm, tìm theo tên, lọc theo danh mục,
thêm/sửa/xóa. Có thể nhập URL ảnh thay vì làm chức năng upload.

API: `GET /api/products`, `GET /api/products/:id`, `POST /api/products`,
`PATCH /api/products/:id`, `DELETE /api/products/:id`.

Chưa cần nhiều ảnh, biến thể màu sắc/công suất, SKU phức tạp hoặc upload
file.

### 4.6. Quản lý đơn hàng --- `/orders`

Dữ liệu: mã đơn, khách hàng, ngày đặt, tổng tiền, phương thức thanh
toán, trạng thái.

Trạng thái đơn giản: - `pending`: Chờ xác nhận - `confirmed`: Đã xác
nhận - `shipping`: Đang giao - `completed`: Hoàn thành - `cancelled`: Đã
hủy

Chức năng: xem danh sách, tìm theo mã đơn, lọc theo trạng thái, xem chi
tiết gồm sản phẩm/số lượng/đơn giá/tổng tiền/địa chỉ giao hàng, cập nhật
trạng thái và xác nhận trước khi hủy.

API: `GET /api/orders`, `GET /api/orders/:id`,
`PATCH /api/orders/:id/status`.

Chưa cần hoàn tiền, quản lý đơn vị vận chuyển, in hóa đơn hoặc xử lý
khiếu nại. Backend phải kiểm tra các chuyển đổi trạng thái hợp lệ.

### 4.7. Quản lý người dùng --- `/users`

Chỉ quản lý tài khoản khách hàng; không cho Admin thay đổi vai trò quản
trị.

Dữ liệu: họ tên, email, số điện thoại nếu có, ngày đăng ký, trạng thái
tài khoản.

Chức năng: xem danh sách, tìm theo tên/email, xem thông tin cơ bản,
khóa/mở khóa tài khoản.

API: `GET /api/users`, `GET /api/users/:id`,
`PATCH /api/users/:id/status`.

Chưa cần xóa tài khoản hoặc xem lịch sử hoạt động chi tiết.

### 4.8. Hồ sơ cá nhân --- `/profile`

-   Xem thông tin Admin đang đăng nhập.
-   Sửa họ tên và số điện thoại.
-   Đổi mật khẩu bằng mật khẩu hiện tại và mật khẩu mới.

API: `GET /api/auth/me`, `PATCH /api/profile`,
`PATCH /api/profile/password`.

Chưa cần đổi ảnh đại diện hoặc xác thực email.

## 5. Quy tắc giao diện dùng chung

-   Dùng một Admin Layout gồm sidebar, header và khu vực nội dung.
-   Sidebar liên kết tới các trang quản trị; header hiển thị Admin và
    nút đăng xuất.
-   Trang danh sách dùng bảng đơn giản; form thêm/sửa dùng Dialog hoặc
    Sheet.
-   Có loading, thông báo thành công/thất bại, trạng thái danh sách
    trống.
-   Xác nhận trước khi xóa hoặc hủy thao tác quan trọng.
-   Có thể làm phân trang đơn giản khi dữ liệu nhiều.
-   Ưu tiên hiển thị tốt trên laptop; responsive điện thoại là phần cải
    tiến.

## 6. Quy tắc nghiệp vụ cơ bản

-   Chưa đăng nhập chỉ được truy cập `/login`; Admin đã đăng nhập mới
    truy cập các trang quản trị.
-   Backend phải kiểm tra quyền Admin, không chỉ ẩn route ở frontend.
-   Giá và số lượng tồn kho không được âm; email phải duy nhất.
-   Không xóa danh mục/thương hiệu đang được sản phẩm tham chiếu nếu
    chưa có quy tắc xử lý.
-   Backend kiểm tra trạng thái đơn hàng hợp lệ.
-   Hash mật khẩu ở backend, không lưu mật khẩu dạng văn bản thuần.
-   API danh sách người dùng không được trả về mật khẩu hoặc dữ liệu
    nhạy cảm.

## 7. Database MongoDB tham khảo

Bản học tập chỉ cần 5 collection:

### `users`

`fullName`, `email`, `passwordHash`, `phone` (optional), `role`
(`admin`/`customer`), `status` (`active`/`blocked`), `createdAt`,
`updatedAt`.

### `brands`

`name`, `description` (optional), `status`, `createdAt`, `updatedAt`.

### `categories`

`name`, `description` (optional), `status`, `createdAt`, `updatedAt`.

### `products`

`name`, `description` (optional), `brandId` (ObjectId, optional),
`categoryId` (ObjectId), `price`, `stock`, `imageUrl` (optional),
`status`, `createdAt`, `updatedAt`.

### `orders`

`orderCode`, `userId` (ObjectId), `items` (mảng gồm `productId`,
`productName`, `price`, `quantity`), `total`, `shippingAddress`,
`paymentMethod`, `status`, `createdAt`, `updatedAt`.

Để đơn giản, nhúng `items` trong `orders`, chưa cần collection
`orderItems` riêng. Lưu tên và giá sản phẩm tại thời điểm đặt hàng để
thông tin đơn cũ không thay đổi khi sản phẩm được sửa.

## 8. API tối thiểu

  Nhóm         Method   Endpoint                    Mục đích
  ------------ -------- --------------------------- -----------------------
  Auth         POST     `/api/auth/login`           Đăng nhập
  Auth         GET      `/api/auth/me`              Lấy Admin hiện tại
  Dashboard    GET      `/api/dashboard/overview`   Thống kê tổng quan
  Brands       GET      `/api/brands`               Danh sách thương hiệu
  Brands       POST     `/api/brands`               Thêm thương hiệu
  Brands       PATCH    `/api/brands/:id`           Sửa thương hiệu
  Brands       DELETE   `/api/brands/:id`           Xóa thương hiệu
  Categories   GET      `/api/categories`           Danh sách danh mục
  Categories   POST     `/api/categories`           Thêm danh mục
  Categories   PATCH    `/api/categories/:id`       Sửa danh mục
  Categories   DELETE   `/api/categories/:id`       Xóa danh mục
  Products     GET      `/api/products`             Danh sách sản phẩm
  Products     GET      `/api/products/:id`         Chi tiết sản phẩm
  Products     POST     `/api/products`             Thêm sản phẩm
  Products     PATCH    `/api/products/:id`         Sửa sản phẩm
  Products     DELETE   `/api/products/:id`         Xóa sản phẩm
  Orders       GET      `/api/orders`               Danh sách đơn hàng
  Orders       GET      `/api/orders/:id`           Chi tiết đơn hàng
  Orders       PATCH    `/api/orders/:id/status`    Cập nhật trạng thái
  Users        GET      `/api/users`                Danh sách khách hàng
  Users        GET      `/api/users/:id`            Chi tiết khách hàng
  Users        PATCH    `/api/users/:id/status`     Khóa/mở khóa
  Profile      PATCH    `/api/profile`              Sửa hồ sơ Admin
  Profile      PATCH    `/api/profile/password`     Đổi mật khẩu

Đây là endpoint đề xuất, chưa phải API đã triển khai. Có thể thêm query
`page`, `limit`, `search`, `status` khi làm phân trang và bộ lọc.

## 9. Cấu trúc thư mục frontend tham khảo

``` text
src/
├── components/
│   ├── layout/
│   │   ├── AdminLayout.tsx
│   │   ├── AdminSidebar.tsx
│   │   └── AdminHeader.tsx
│   └── common/
│       ├── ConfirmDialog.tsx
│       ├── DataTable.tsx
│       └── PageLoading.tsx
├── pages/
│   ├── auth/LoginPage.tsx
│   ├── dashboard/DashboardPage.tsx
│   ├── brands/BrandsPage.tsx
│   ├── categories/CategoriesPage.tsx
│   ├── products/ProductsPage.tsx
│   ├── orders/OrdersPage.tsx
│   ├── orders/OrderDetailPage.tsx
│   ├── users/UsersPage.tsx
│   └── profile/ProfilePage.tsx
├── services/
│   ├── api.ts
│   ├── auth.service.ts
│   ├── brand.service.ts
│   ├── category.service.ts
│   ├── product.service.ts
│   ├── order.service.ts
│   └── user.service.ts
├── hooks/
├── schemas/
├── types/
├── routes/AppRouter.tsx
├── lib/
└── main.tsx
```

Có thể bắt đầu chỉ với một page và một service cho mỗi module; tách thêm
hooks/components khi thật sự cần.

## 10. Thứ tự triển khai

1.  Khởi tạo React + TypeScript bằng Vite, cấu hình Tailwind.
2.  Tạo Router và Admin Layout.
3.  Làm Login và bảo vệ route.
4.  Làm Brands CRUD.
5.  Làm Categories CRUD.
6.  Làm Products CRUD.
7.  Làm Users: danh sách, tìm kiếm, khóa/mở khóa.
8.  Làm Orders: danh sách, chi tiết, cập nhật trạng thái.
9.  Làm Dashboard tổng quan.
10. Làm Profile và đổi mật khẩu.
11. Kiểm tra validation, lỗi API, loading và responsive.

Nên hoàn thiện từng module theo luồng
`UI → form validation → service gọi API → backend validation → database`
rồi mới chuyển sang module tiếp theo. Có thể dùng dữ liệu mẫu tạm thời,
nhưng cần phân biệt rõ dữ liệu mẫu với dữ liệu API thật.

## 11. Để dành sau đồ án

Chỉ bổ sung nếu còn thời gian: upload nhiều ảnh, biến thể sản phẩm, mã
giảm giá, hoàn tiền, quản lý vận chuyển, xuất Excel/PDF, biểu đồ nâng
cao, nhật ký hoạt động và phân quyền nhiều cấp.

**Phạm vi tối thiểu hoàn thành:** đăng nhập Admin, CRUD thương hiệu/danh
mục/sản phẩm, quản lý đơn hàng cơ bản, quản lý khách hàng, hồ sơ Admin
và dashboard thống kê.
