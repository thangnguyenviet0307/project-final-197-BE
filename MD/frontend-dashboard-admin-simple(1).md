# Frontend Admin Dashboard – Website bán phụ kiện điện thoại

> Phiên bản rút gọn dành cho học tập và đồ án. Phạm vi là website bán hàng của một cửa hàng duy nhất, không làm multi-vendor.

## 1. Nguyên tắc

- Giữ nguyên 8 trang Admin đã thống nhất.
- Ưu tiên CRUD cơ bản: xem, thêm, sửa, xóa.
- Giao diện dùng bảng, form, hộp thoại xác nhận và thông báo kết quả.
- Tìm kiếm đơn giản ở sản phẩm, đơn hàng, người dùng là tùy chọn.
- Có thể dựng giao diện bằng mock data trước rồi mới kết nối API.
- Chưa cần biểu đồ phức tạp, upload nhiều ảnh, biến thể sản phẩm, xuất Excel/PDF hay quy trình kho vận nâng cao.

## 2. Danh sách trang

| STT | Trang | Route | Chức năng chính |
|---:|---|---|---|
| 1 | Dashboard tổng quan | `/dashboard` | Số liệu cơ bản và đơn hàng gần đây |
| 2 | Đăng nhập | `/login` | Admin đăng nhập |
| 3 | Quản lý thương hiệu | `/brands` | Xem, thêm, sửa, xóa thương hiệu |
| 4 | Quản lý danh mục | `/categories` | Xem, thêm, sửa, xóa danh mục |
| 5 | Quản lý sản phẩm | `/products` | Xem, thêm, sửa, xóa sản phẩm |
| 6 | Quản lý đơn hàng | `/orders` | Xem đơn và cập nhật trạng thái |
| 7 | Quản lý người dùng | `/users` | Xem khách hàng, khóa/mở khóa |
| 8 | Hồ sơ cá nhân | `/profile` | Sửa thông tin Admin, đổi mật khẩu |

Tất cả trang quản trị yêu cầu đăng nhập Admin, ngoại trừ `/login`.

## 3. Chức năng từng trang

### 3.1 Dashboard — `/dashboard`

**Giao diện tối thiểu**
- Tổng số sản phẩm.
- Tổng số đơn hàng.
- Tổng số khách hàng.
- Tổng doanh thu từ đơn đã giao.
- Bảng 5 đơn hàng mới nhất: mã đơn, khách hàng, ngày đặt, tổng tiền, trạng thái.

Chưa cần biểu đồ, bộ lọc thời gian hoặc danh sách sản phẩm bán chạy.

**API gợi ý**

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/dashboard/summary` | Lấy số liệu tổng quan |
| GET | `/api/orders?limit=5` | Lấy đơn hàng mới nhất |

### 3.2 Đăng nhập — `/login`

**Giao diện:** email, mật khẩu, nút đăng nhập, thông báo lỗi.

**Luồng:** gửi thông tin lên API; thành công thì chuyển đến `/dashboard`; thất bại thì hiện lỗi. Route Admin được bảo vệ, người chưa đăng nhập sẽ chuyển về `/login`. Có thể tạo sẵn tài khoản Admin trong database, không cần chức năng đăng ký Admin.

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập |
| GET | `/api/auth/me` | Lấy Admin hiện tại |

### 3.3 Quản lý thương hiệu — `/brands`

**Giao diện:** bảng tên thương hiệu, mô tả; nút thêm, sửa, xóa; xác nhận trước khi xóa.

**Dữ liệu:** `name` (bắt buộc), `description` (không bắt buộc). Chưa cần logo.

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/brands` | Danh sách |
| POST | `/api/brands` | Thêm |
| PATCH | `/api/brands/:id` | Sửa |
| DELETE | `/api/brands/:id` | Xóa |

### 3.4 Quản lý danh mục — `/categories`

**Giao diện:** bảng tên danh mục, mô tả; nút thêm, sửa, xóa.

**Dữ liệu:** `name` (bắt buộc), `description` (không bắt buộc). Chưa cần danh mục cha/con. Nếu danh mục đang được sản phẩm sử dụng, Backend nên chặn xóa hoặc yêu cầu xử lý sản phẩm liên quan.

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/categories` | Danh sách |
| POST | `/api/categories` | Thêm |
| PATCH | `/api/categories/:id` | Sửa |
| DELETE | `/api/categories/:id` | Xóa |

### 3.5 Quản lý sản phẩm — `/products`

**Giao diện:** bảng ảnh đại diện, tên, giá, tồn kho, danh mục; tìm kiếm theo tên; nút thêm, sửa, xóa.

**Dữ liệu tối thiểu**

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `name` | String | Có | Tên sản phẩm |
| `price` | Number | Có | Lớn hơn 0 |
| `stock` | Number | Có | Không âm |
| `brandId` | ObjectId | Có | Chọn thương hiệu |
| `categoryId` | ObjectId | Có | Chọn danh mục |
| `image` | String | Không | URL ảnh |
| `description` | String | Không | Mô tả ngắn |

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/products` | Danh sách |
| GET | `/api/products/:id` | Chi tiết |
| POST | `/api/products` | Thêm |
| PATCH | `/api/products/:id` | Sửa |
| DELETE | `/api/products/:id` | Xóa |

Để giảm độ khó, chỉ cần một ảnh bằng URL; chưa cần upload cloud, giá khuyến mãi, thông số động hoặc biến thể màu sắc/kích thước.

### 3.6 Quản lý đơn hàng — `/orders`

**Giao diện:** bảng mã đơn, khách hàng, ngày đặt, tổng tiền, trạng thái; xem chi tiết; chọn trạng thái mới từ danh sách.

Chi tiết đơn gồm sản phẩm, số lượng, đơn giá, địa chỉ nhận hàng và tổng tiền.

**Trạng thái tối giản:** `pending` (chờ xác nhận), `confirmed` (đã xác nhận), `shipping` (đang giao), `delivered` (đã giao), `cancelled` (đã hủy).

Chưa cần quản lý hoàn tiền hoặc trạng thái thanh toán riêng.

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/orders` | Danh sách |
| GET | `/api/orders/:id` | Chi tiết |
| PATCH | `/api/orders/:id/status` | Cập nhật trạng thái |

Backend nên kiểm tra các chuyển trạng thái hợp lệ, không chỉ dựa vào giao diện.

### 3.7 Quản lý người dùng — `/users`

**Giao diện:** bảng họ tên, email, số điện thoại (nếu có), trạng thái; xem thông tin; khóa/mở khóa và xác nhận trước khi thực hiện.

**Dữ liệu hiển thị:** `fullName`, `email`, `phone` (tùy chọn), `status` (`active` hoặc `blocked`).

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/users` | Danh sách khách hàng |
| GET | `/api/users/:id` | Chi tiết |
| PATCH | `/api/users/:id/status` | Khóa/mở khóa |

Chưa cần trang lịch sử mua hàng riêng. API tuyệt đối không trả mật khẩu hoặc password hash. Tránh cho Admin khóa chính tài khoản đang dùng để quản trị.

### 3.8 Hồ sơ cá nhân — `/profile`

**Giao diện:** họ tên, email, số điện thoại; form sửa họ tên/số điện thoại; form đổi mật khẩu gồm mật khẩu hiện tại, mật khẩu mới và xác nhận mật khẩu mới.

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/auth/me` | Lấy thông tin Admin |
| PATCH | `/api/profile` | Cập nhật thông tin |
| PATCH | `/api/profile/password` | Đổi mật khẩu |

Có thể bỏ upload avatar ở phiên bản đầu. Email chỉ đọc để tránh xử lý xác minh email.

## 4. Layout dùng chung

Dùng một `AdminLayout` cho các trang quản trị:
- Sidebar: Dashboard, Thương hiệu, Danh mục, Sản phẩm, Đơn hàng, Người dùng, Hồ sơ.
- Header: tiêu đề trang, tên Admin, nút đăng xuất.
- Khu vực nội dung chính.
- Có trạng thái loading, empty, error và thông báo sau khi thêm/sửa/xóa.

Trang `/login` dùng layout riêng, không có sidebar.

## 5. Tech stack gợi ý

| Công nghệ | Mục đích | Mức độ |
|---|---|---|
| React + TypeScript + Vite | Xây dựng ứng dụng | Cần |
| React Router | Điều hướng | Cần |
| Tailwind CSS | Giao diện responsive | Cần |
| shadcn/ui | Button, Input, Dialog, Table, Select | Tùy chọn |
| Lucide React | Icon | Tùy chọn |
| Axios | Gọi API | Nên dùng |
| TanStack Query | Quản lý dữ liệu API | Nên dùng |
| React Hook Form | Quản lý form | Tùy chọn |
| Zod | Validate form | Tùy chọn |
| Zustand | State dùng chung | Chưa cần lúc đầu |
| Recharts | Biểu đồ | Chưa cần |

Không cần cài tất cả ngay. Hãy làm layout, routing và một trang CRUD trước rồi bổ sung thư viện khi cần.

## 6. Cấu trúc thư mục đề xuất

```text
src/
├── components/
│   ├── layout/
│   │   ├── AdminLayout.tsx
│   │   ├── Sidebar.tsx
│   │   └── Header.tsx
│   └── common/
│       ├── ConfirmDialog.tsx
│       ├── PageLoading.tsx
│       └── EmptyState.tsx
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── BrandsPage.tsx
│   ├── CategoriesPage.tsx
│   ├── ProductsPage.tsx
│   ├── OrdersPage.tsx
│   ├── UsersPage.tsx
│   └── ProfilePage.tsx
├── services/
│   ├── api.ts
│   ├── auth.service.ts
│   ├── brand.service.ts
│   ├── category.service.ts
│   ├── product.service.ts
│   ├── order.service.ts
│   ├── user.service.ts
│   └── profile.service.ts
├── types/
├── routes/
│   └── AppRouter.tsx
├── hooks/
├── lib/
└── main.tsx
```

Chỉ tạo `schemas/` khi dùng Zod và `stores/` khi thực sự cần Zustand; không cần tạo nhiều thư mục rỗng.

## 7. Trạng thái giao diện cần xử lý

1. **Loading:** đang tải dữ liệu.
2. **Success:** hiển thị dữ liệu.
3. **Empty:** chưa có dữ liệu.
4. **Error:** API lỗi hoặc mất kết nối.
5. **Mutation feedback:** báo kết quả sau khi thêm, sửa hoặc xóa.

Form cần kiểm tra trường bắt buộc, kiểu dữ liệu và hiển thị lỗi dễ hiểu.

## 8. Thứ tự triển khai

1. Tạo React + TypeScript + Vite và cấu hình Tailwind.
2. Tạo routing cho 8 trang.
3. Làm `AdminLayout`, sidebar và header bằng dữ liệu giả.
4. Làm Login và bảo vệ route.
5. Làm CRUD Thương hiệu.
6. Làm CRUD Danh mục.
7. Làm CRUD Sản phẩm, chọn thương hiệu/danh mục từ API.
8. Làm danh sách, chi tiết đơn hàng và cập nhật trạng thái.
9. Làm danh sách người dùng và khóa/mở khóa.
10. Làm Hồ sơ cá nhân và đổi mật khẩu.
11. Hoàn thiện Dashboard bằng số liệu tổng quan.
12. Kiểm tra loading, empty, error và responsive.

**Cách học hiệu quả:** Hoàn thành trọn một luồng giao diện → API → database cho Thương hiệu trước, rồi áp dụng cách làm tương tự cho Danh mục và Sản phẩm.

## 9. Tính năng để dành nếu còn thời gian

- Biểu đồ doanh thu theo ngày/tháng.
- Upload ảnh lên Cloudinary hoặc dịch vụ tương tự.
- Bộ lọc nhiều điều kiện, phân trang nâng cao.
- Xuất Excel/PDF.
- Mã giảm giá, đánh giá sản phẩm, hoàn tiền.
- Quản lý nhiều kho hoặc biến thể sản phẩm.
- Nhiều cấp quyền quản trị.

**Mục tiêu phiên bản cơ bản:** nắm chắc CRUD, gọi API, validate form, routing, đăng nhập và xử lý lỗi trước khi mở rộng tính năng.
