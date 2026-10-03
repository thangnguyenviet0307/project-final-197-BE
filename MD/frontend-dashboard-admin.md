# Frontend Dashboard – Đặc tả chi tiết

## II. Danh sách Page

| STT | Page | Route | Role |
|---|---|---|---|
| 1 | Dashboard tổng quan | `/dashboard` | Admin |
| 2 | Đăng nhập | `/login` | Admin |
| 3 | Quản lý thương hiệu | `/brands` | Admin |
| 4 | Quản lý danh mục | `/categories` | Admin |
| 5 | Quản lý sản phẩm | `/products` | Admin |
| 6 | Quản lý đơn hàng | `/orders` | Admin |
| 7 | Quản lý người dùng | `/users` | Admin |
| 8 | Hồ sơ cá nhân | `/profile` | Admin |

---

# III. Đặc tả chi tiết từng Page

## 1. Dashboard tổng quan

| Hạng mục | Nội dung |
|---|---|
| Route | `/dashboard` |
| Role truy cập | Admin |
| Mục đích | Cung cấp cái nhìn tổng quan về tình hình kinh doanh của website |

### Thành phần giao diện cần code

- Tổng số sản phẩm
- Tổng số danh mục
- Tổng số thương hiệu
- Tổng số người dùng
- Tổng số đơn hàng
- Doanh thu
- Đơn hàng chờ xử lý
- Đơn hàng đang giao
- Đơn hàng hoàn thành
- Biểu đồ doanh thu
- Biểu đồ số lượng đơn hàng
- Danh sách đơn hàng gần đây
- Danh sách sản phẩm bán chạy
- Loading state
- Empty state
- Error state

### Dữ liệu hiển thị

| Field | Kiểu dữ liệu | Ghi chú |
|---|---|---|
| totalProducts | Number | Tổng số sản phẩm |
| totalCategories | Number | Tổng số danh mục |
| totalBrands | Number | Tổng số thương hiệu |
| totalUsers | Number | Tổng số người dùng |
| totalOrders | Number | Tổng số đơn hàng |
| totalRevenue | Number | Tổng doanh thu |
| pendingOrders | Number | Đơn hàng chờ xử lý |
| processingOrders | Number | Đơn hàng đang xử lý |
| shippingOrders | Number | Đơn hàng đang giao |
| completedOrders | Number | Đơn hàng hoàn thành |

### Hành động trên trang

| Action | Mô tả |
|---|---|
| Xem sản phẩm | Điều hướng `/products` |
| Xem đơn hàng | Điều hướng `/orders` |
| Xem người dùng | Điều hướng `/users` |
| Xem danh mục | Điều hướng `/categories` |
| Xem thương hiệu | Điều hướng `/brands` |
| Lọc doanh thu | Lọc theo khoảng thời gian |
| Xem đơn hàng | Mở chi tiết đơn hàng |

### API cần dùng

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/dashboard/overview` | Lấy thống kê tổng quan |
| GET | `/api/dashboard/revenue` | Lấy dữ liệu doanh thu |
| GET | `/api/dashboard/orders` | Thống kê đơn hàng |
| GET | `/api/dashboard/best-selling-products` | Lấy sản phẩm bán chạy |
| GET | `/api/orders?limit=5` | Lấy đơn hàng gần đây |

### Database liên quan

- `users`
- `brands`
- `categories`
- `products`
- `orders`
- `orderItems`

### Frontend cần code

- `DashboardPage.tsx`
- Statistic cards
- Revenue chart
- Order chart
- Recent orders table
- Best-selling products
- Date filter

### Backend/API cần chuẩn bị

- API thống kê dashboard
- MongoDB aggregation
- Tính doanh thu
- Thống kê order theo status
- Thống kê sản phẩm bán chạy
- Chỉ cho phép Admin truy cập

---

## 2. Đăng nhập

| Hạng mục | Nội dung |
|---|---|
| Route | `/login` |
| Role truy cập | Admin |
| Mục đích | Cho phép Admin đăng nhập vào hệ thống quản trị |

### Thành phần giao diện cần code

- Input Email
- Input Password
- Nút Đăng nhập
- Hiển thị/ẩn password
- Thông báo lỗi
- Loading khi submit

### Dữ liệu/Form field

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
|---|---|---|---|
| email | String | Có | Đúng định dạng email |
| password | String | Có | Tối thiểu 6 ký tự |

### Hành động trên trang

| Action | Mô tả |
|---|---|
| Đăng nhập | Gửi email/password lên server |
| Hiển thị lỗi | Hiển thị lỗi validation/API |
| Đăng nhập thành công | Lưu authentication information và chuyển `/dashboard` |

### API cần dùng

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập Admin |
| GET | `/api/auth/me` | Lấy thông tin Admin hiện tại |

### Database liên quan

- `users`

### Frontend cần code

- `LoginPage.tsx`
- Login form
- Form validation
- Authentication state
- Protected route

### Backend/API cần chuẩn bị

- Kiểm tra email/password
- Hash password
- Verify password
- Tạo JWT
- Kiểm tra role Admin
- Trả thông tin user

### Flow

```text
Login
  ↓
POST /api/auth/login
  ↓
Validate email/password
  ↓
Find User
  ↓
Verify Password
  ↓
Check Role = Admin
  ↓
Generate JWT
  ↓
Frontend lưu authentication
  ↓
/dashboard
```

---

## 3. Quản lý thương hiệu

| Hạng mục | Nội dung |
|---|---|
| Route | `/brands` |
| Role truy cập | Admin |
| Mục đích | Quản lý các thương hiệu sản phẩm |

### Thành phần giao diện cần code

- Bảng danh sách thương hiệu
- Search
- Pagination
- Nút thêm thương hiệu
- Nút sửa
- Nút xóa
- Modal tạo thương hiệu
- Modal sửa thương hiệu
- Confirm dialog khi xóa

### Dữ liệu/Form field

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
|---|---|---|---|
| name | String | Có | Tên thương hiệu, unique |
| slug | String | Có | Unique |
| description | String | Không | Mô tả |
| logo | String | Không | URL logo |
| status | String | Có | `active`, `inactive` |

### Hành động trên trang

| Action | Mô tả |
|---|---|
| Thêm | Tạo thương hiệu mới |
| Sửa | Cập nhật thương hiệu |
| Xóa | Xóa thương hiệu |
| Tìm kiếm | Tìm theo tên |
| Lọc | Lọc theo trạng thái |
| Pagination | Phân trang |

### API cần dùng

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/brands` | Lấy danh sách |
| GET | `/api/brands/:id` | Lấy chi tiết |
| POST | `/api/brands` | Tạo thương hiệu |
| PATCH | `/api/brands/:id` | Cập nhật |
| DELETE | `/api/brands/:id` | Xóa |

### Database liên quan

- `brands`
- `products`

### Frontend cần code

- `BrandsPage.tsx`
- `BrandTable`
- `BrandForm`
- `BrandDialog`
- Search
- Pagination
- ConfirmDialog

### Backend/API cần chuẩn bị

- CRUD brands
- Unique name
- Unique slug
- Kiểm tra brand đang được product sử dụng trước khi xóa
- Admin authorization

---

## 4. Quản lý danh mục

| Hạng mục | Nội dung |
|---|---|
| Route | `/categories` |
| Role truy cập | Admin |
| Mục đích | Quản lý danh mục sản phẩm |

### Thành phần giao diện cần code

- Danh sách danh mục
- Search
- Category tree nếu có danh mục cha/con
- Nút thêm
- Nút sửa
- Nút xóa
- Modal tạo/sửa
- Pagination

### Dữ liệu/Form field

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
|---|---|---|---|
| name | String | Có | Tên danh mục |
| slug | String | Có | Unique |
| description | String | Không | Mô tả |
| image | String | Không | URL hình ảnh |
| parentId | ObjectId/null | Không | Danh mục cha |
| status | String | Có | `active`, `inactive` |

### Hành động trên trang

| Action | Mô tả |
|---|---|
| Thêm | Tạo category |
| Sửa | Cập nhật category |
| Xóa | Xóa category |
| Tìm kiếm | Tìm category |
| Lọc | Lọc theo trạng thái |
| Xem sản phẩm | Xem sản phẩm thuộc category |

### API cần dùng

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/categories` | Danh sách |
| GET | `/api/categories/:id` | Chi tiết |
| POST | `/api/categories` | Tạo |
| PATCH | `/api/categories/:id` | Cập nhật |
| DELETE | `/api/categories/:id` | Xóa |

### Database liên quan

- `categories`
- `products`

### Frontend cần code

- `CategoriesPage.tsx`
- `CategoryTable`
- `CategoryForm`
- Category tree
- Search
- Filter
- Pagination

### Backend/API cần chuẩn bị

- CRUD categories
- Unique slug
- Parent-child relationship
- Kiểm tra category đang được product sử dụng trước khi xóa
- Admin authorization

---

## 5. Quản lý sản phẩm

| Hạng mục | Nội dung |
|---|---|
| Route | `/products` |
| Role truy cập | Admin |
| Mục đích | Quản lý toàn bộ sản phẩm bán trên website |

### Thành phần giao diện cần code

- Product table
- Hình ảnh sản phẩm
- Tên sản phẩm
- Giá
- Giá khuyến mãi
- Thương hiệu
- Danh mục
- Tồn kho
- Trạng thái
- Search
- Filter category
- Filter brand
- Filter status
- Pagination
- Nút thêm sản phẩm
- Nút sửa
- Nút xóa

### Dữ liệu/Form field

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
|---|---|---|---|
| name | String | Có | Tên sản phẩm |
| slug | String | Có | Unique |
| description | String | Không | Mô tả |
| brandId | ObjectId | Có | Thương hiệu |
| categoryId | ObjectId | Có | Danh mục |
| price | Number | Có | Giá bán |
| salePrice | Number | Không | Giá khuyến mãi |
| stock | Number | Có | Tồn kho |
| images | Array[String] | Có | Hình ảnh |
| specifications | Object | Không | Thông số sản phẩm |
| status | String | Có | `active`, `inactive` |

### Hành động trên trang

| Action | Mô tả |
|---|---|
| Thêm sản phẩm | Tạo sản phẩm |
| Sửa sản phẩm | Cập nhật |
| Xóa sản phẩm | Xóa |
| Tìm kiếm | Theo tên |
| Lọc brand | Theo thương hiệu |
| Lọc category | Theo danh mục |
| Lọc status | Theo trạng thái |
| Cập nhật stock | Cập nhật tồn kho |
| Upload ảnh | Upload hình ảnh |

### API cần dùng

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/products` | Danh sách sản phẩm |
| GET | `/api/products/:id` | Chi tiết |
| POST | `/api/products` | Tạo |
| PATCH | `/api/products/:id` | Cập nhật |
| DELETE | `/api/products/:id` | Xóa |
| POST | `/api/products/upload` | Upload hình ảnh |

### Database liên quan

- `products`
- `brands`
- `categories`
- `orders`
- `orderItems`

### Frontend cần code

- `ProductsPage.tsx`
- `ProductTable`
- `ProductForm`
- `ProductImageUpload`
- `ProductSpecifications`
- Search
- Filter
- Pagination

### Backend/API cần chuẩn bị

- CRUD products
- Brand validation
- Category validation
- Stock validation
- Price validation
- Image upload
- Slug generation
- Admin authorization

---

## 6. Quản lý đơn hàng

| Hạng mục | Nội dung |
|---|---|
| Route | `/orders` |
| Role truy cập | Admin |
| Mục đích | Quản lý và xử lý các đơn hàng của khách hàng |

### Thành phần giao diện cần code

- Order table
- Mã đơn hàng
- Tên khách hàng
- Tổng tiền
- Trạng thái đơn hàng
- Trạng thái thanh toán
- Ngày đặt hàng
- Search
- Filter status
- Filter payment status
- Filter date
- Pagination
- Order detail
- Cập nhật trạng thái

### Dữ liệu/Form field

| Field | Kiểu dữ liệu | Bắt buộc | Ghi chú |
|---|---|---|---|
| userId | ObjectId | Có | Người đặt |
| orderCode | String | Có | Mã đơn hàng |
| items | Array | Có | Sản phẩm |
| subtotal | Number | Có | Tạm tính |
| shippingFee | Number | Có | Phí vận chuyển |
| discount | Number | Không | Giảm giá |
| total | Number | Có | Tổng tiền |
| shippingAddress | Object | Có | Địa chỉ giao hàng |
| paymentMethod | String | Có | Phương thức thanh toán |
| paymentStatus | String | Có | Trạng thái thanh toán |
| orderStatus | String | Có | Trạng thái đơn |

### Order Status

```text
pending
   ↓
confirmed
   ↓
processing
   ↓
shipping
   ↓
delivered

cancelled
```

### Payment Status

```text
pending
paid
failed
refunded
```

### Hành động trên trang

| Action | Mô tả |
|---|---|
| Xem đơn hàng | Xem chi tiết |
| Xác nhận | Xác nhận đơn |
| Xử lý | Chuyển sang processing |
| Giao hàng | Chuyển sang shipping |
| Hoàn thành | Chuyển sang delivered |
| Hủy | Hủy đơn hàng |
| Cập nhật payment | Cập nhật trạng thái thanh toán |
| Tìm kiếm | Theo order code/customer |
| Lọc | Theo status |

### API cần dùng

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/orders` | Danh sách đơn hàng |
| GET | `/api/orders/:id` | Chi tiết |
| PATCH | `/api/orders/:id/status` | Cập nhật trạng thái |
| PATCH | `/api/orders/:id/payment-status` | Cập nhật thanh toán |
| POST | `/api/orders/:id/cancel` | Hủy đơn |

### Database liên quan

- `orders`
- `orderItems`
- `users`
- `products`

### Frontend cần code

- `OrdersPage.tsx`
- `OrderTable`
- `OrderDetail`
- `OrderStatusBadge`
- `OrderStatusSelect`
- Search
- Filter
- Pagination

### Backend/API cần chuẩn bị

- Order management
- Status transition
- Kiểm tra tồn kho
- Cập nhật stock
- Tính tổng tiền
- Order history
- Authorization

---

## 7. Quản lý người dùng

| Hạng mục | Nội dung |
|---|---|
| Route | `/users` |
| Role truy cập | Admin |
| Mục đích | Quản lý tài khoản khách hàng trên website |

### Thành phần giao diện cần code

- User table
- Avatar
- Họ tên
- Email
- Số điện thoại
- Số đơn hàng
- Trạng thái tài khoản
- Search
- Filter status
- Pagination
- Xem chi tiết
- Khóa tài khoản
- Mở khóa tài khoản

### Dữ liệu

| Field | Kiểu dữ liệu | Bắt buộc | Ghi chú |
|---|---|---|---|
| fullName | String | Có | Họ tên |
| email | String | Có | Email unique |
| phone | String | Không | Số điện thoại |
| avatar | String | Không | URL avatar |
| role | String | Có | `customer`, `admin` |
| status | String | Có | `active`, `blocked` |
| createdAt | Date | Tự động | Ngày đăng ký |

### Hành động trên trang

| Action | Mô tả |
|---|---|
| Xem | Xem thông tin user |
| Tìm kiếm | Theo tên/email |
| Lọc | Theo status |
| Khóa | Khóa tài khoản |
| Mở khóa | Mở lại tài khoản |
| Xem đơn hàng | Xem lịch sử đơn hàng |

### API cần dùng

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/users` | Danh sách |
| GET | `/api/users/:id` | Chi tiết |
| GET | `/api/users/:id/orders` | Lịch sử đơn hàng |
| PATCH | `/api/users/:id/status` | Khóa/mở khóa |

### Database liên quan

- `users`
- `orders`

### Frontend cần code

- `UsersPage.tsx`
- `UserTable`
- `UserDetail`
- `UserStatusBadge`
- Search
- Filter
- Pagination

### Backend/API cần chuẩn bị

- User management
- Không trả password hash
- Block/unblock account
- Authorization

---

## 8. Hồ sơ cá nhân

| Hạng mục | Nội dung |
|---|---|
| Route | `/profile` |
| Role truy cập | Admin |
| Mục đích | Cho phép Admin xem và cập nhật thông tin cá nhân |

### Thành phần giao diện cần code

- Avatar
- Họ tên
- Email
- Số điện thoại
- Role
- Ngày tạo tài khoản
- Form cập nhật profile
- Form đổi password
- Upload avatar

### Dữ liệu/Form field

#### Profile

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
|---|---|---|---|
| fullName | String | Có | Họ tên |
| email | String | Có | Email |
| phone | String | Không | Số điện thoại |
| avatar | String | Không | URL ảnh |

#### Change Password

| Field | Kiểu dữ liệu | Bắt buộc | Validation/Ghi chú |
|---|---|---|---|
| currentPassword | String | Có | Password hiện tại |
| newPassword | String | Có | Tối thiểu 6 ký tự |
| confirmPassword | String | Có | Phải trùng newPassword |

### Hành động trên trang

| Action | Mô tả |
|---|---|
| Cập nhật profile | Cập nhật thông tin |
| Upload avatar | Thay avatar |
| Đổi password | Thay đổi mật khẩu |

### API cần dùng

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/auth/me` | Lấy Admin hiện tại |
| PATCH | `/api/profile` | Cập nhật profile |
| PATCH | `/api/profile/password` | Đổi password |
| POST | `/api/profile/avatar` | Upload avatar |

### Database liên quan

- `users`

### Frontend cần code

- `ProfilePage.tsx`
- `ProfileForm`
- `ChangePasswordForm`
- `AvatarUpload`

### Backend/API cần chuẩn bị

- JWT authentication
- Lấy user từ JWT
- Verify current password
- Hash new password
- Update profile
- Upload avatar
- Không cho Admin tự thay đổi role

---

# IV. Permission Matrix

| Page | Admin |
|---|:---:|
| `/dashboard` | ✓ |
| `/login` | ✓ |
| `/brands` | ✓ |
| `/categories` | ✓ |
| `/products` | ✓ |
| `/orders` | ✓ |
| `/users` | ✓ |
| `/profile` | ✓ |

---

# V. Database Collection

| Collection | Mục đích |
|---|---|
| `users` | Tài khoản Admin/khách hàng |
| `brands` | Thương hiệu |
| `categories` | Danh mục |
| `products` | Sản phẩm |
| `orders` | Đơn hàng |
| `orderItems` | Chi tiết sản phẩm trong đơn |

### Quan hệ chính

```text
users
  │
  └── orders
        │
        └── orderItems
              │
              └── products
                    ├── brands
                    └── categories
```

---

# VI. Tổng hợp API

```text
/api
│
├── /auth
│   ├── POST   /login
│   └── GET    /me
│
├── /dashboard
│   ├── GET    /overview
│   ├── GET    /revenue
│   ├── GET    /orders
│   └── GET    /best-selling-products
│
├── /brands
│   ├── GET    /
│   ├── GET    /:id
│   ├── POST   /
│   ├── PATCH  /:id
│   └── DELETE /:id
│
├── /categories
│   ├── GET    /
│   ├── GET    /:id
│   ├── POST   /
│   ├── PATCH  /:id
│   └── DELETE /:id
│
├── /products
│   ├── GET    /
│   ├── GET    /:id
│   ├── POST   /
│   ├── PATCH  /:id
│   ├── DELETE /:id
│   └── POST   /upload
│
├── /orders
│   ├── GET    /
│   ├── GET    /:id
│   ├── PATCH  /:id/status
│   ├── PATCH  /:id/payment-status
│   └── POST   /:id/cancel
│
├── /users
│   ├── GET    /
│   ├── GET    /:id
│   ├── GET    /:id/orders
│   └── PATCH  /:id/status
│
└── /profile
    ├── PATCH  /
    ├── PATCH  /password
    └── POST   /avatar
```

---

# VII. Cấu trúc Frontend đề xuất

```text
src/
├── components/
│   ├── ui/
│   ├── layout/
│   ├── common/
│   ├── tables/
│   └── forms/
│
├── pages/
│   ├── auth/
│   │   └── LoginPage.tsx
│   ├── dashboard/
│   │   └── DashboardPage.tsx
│   ├── brands/
│   │   └── BrandsPage.tsx
│   ├── categories/
│   │   └── CategoriesPage.tsx
│   ├── products/
│   │   └── ProductsPage.tsx
│   ├── orders/
│   │   └── OrdersPage.tsx
│   ├── users/
│   │   └── UsersPage.tsx
│   └── profile/
│       └── ProfilePage.tsx
│
├── services/
│   ├── auth.service.ts
│   ├── dashboard.service.ts
│   ├── brand.service.ts
│   ├── category.service.ts
│   ├── product.service.ts
│   ├── order.service.ts
│   ├── user.service.ts
│   └── profile.service.ts
│
├── hooks/
├── stores/
├── schemas/
├── types/
├── routes/
└── lib/
```

---

# VIII. Thứ tự triển khai

```text
1. Authentication
       ↓
2. Dashboard Layout
       ↓
3. Brands
       ↓
4. Categories
       ↓
5. Products
       ↓
6. Users
       ↓
7. Orders
       ↓
8. Dashboard Statistics
       ↓
9. Profile
```

Về nghiệp vụ dữ liệu:

```text
Users
  │
  └── Orders
        │
        └── OrderItems
              │
              └── Products
                    ├── Brands
                    └── Categories
```
