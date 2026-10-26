# Dữ liệu mẫu với Faker.js

Sử dụng dependency `@faker-js/faker` có sẵn, không cần cài thêm.

Chạy `pnpm seed:check` để tạo và kiểm tra dữ liệu bằng schema Mongoose,
không kết nối hoặc ghi database.
Mỗi bộ dữ liệu được kiểm tra bằng cả validation Zod của API và schema Mongoose.

Để ghi dữ liệu, cấu hình trong `.env`:

```dotenv
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>/project_final?retryWrites=true&w=majority
SEED_PASSWORD=<mật khẩu tự chọn, ít nhất 12 ký tự>
```

Sau đó chạy `pnpm seed`. Chỉ sử dụng database phát triển/test;
lệnh từ chối chạy khi `NODE_ENV=production`.
Lệnh tự đọc `.env` và ghi vào database trong `MONGODB_URI`, giống cấu hình của ứng dụng.
Nếu đã có `MONGODB_URI` kết nối Atlas, giữ nguyên giá trị đó và thêm `SEED_PASSWORD`.
MongoDB cần replica set hoặc sharded cluster để ghi toàn bộ dữ liệu trong transaction.
Lệnh thêm mới, không xóa dữ liệu cũ. Chạy lại sẽ thêm một bộ dữ liệu mới.
Seed chỉ tạo collection còn thiếu và không tạo, sửa hoặc xóa index trên Atlas.
Các index hiện có vẫn được MongoDB kiểm tra khi ghi dữ liệu.

Mỗi lần tạo 8 brands, 10 categories (có danh mục con), 30 customers,
6 users (1 admin, 5 staff), 50 products và 40 orders.
Email admin được in sau khi ghi thành công; các tài khoản mẫu dùng `SEED_PASSWORD`,
được hash bằng Argon2 và yêu cầu đổi mật khẩu khi đăng nhập.
Không in mật khẩu hoặc token.

Mỗi sản phẩm có 1 hoặc 3 biến thể với SKU riêng, tránh khóa `null` trên index unique
`variants.sku_1` hiện có. UUID chỉ dùng cho SKU và email tài khoản mẫu.
Tên và slug category/brand/product không chứa UUID. Seed đọc tên và slug hiện có;
khi trùng sẽ dùng số dễ đọc như `Music (2)` / `music-2` để tránh lỗi index unique.
Đơn hàng tham chiếu khách hàng, sản phẩm và biến thể thật trong bộ dữ liệu,
có snapshot, trạng thái, ngày giao và nhân viên phù hợp.
Tồn kho đã trừ cho đơn chưa bị từ chối; tổng tồn bằng tổng tồn biến thể.
Số điện thoại không trùng trong cùng bộ dữ liệu. Slug category/brand dùng helper
`buildSlug` như service. Tên brand tuân thủ giới hạn 100 ký tự.
Đơn hoàn thành có ngày giao trong quá khứ, không trước ngày tạo;
đơn chưa hoàn thành không có ngày hoàn thành. Snapshot lấy từ khách hàng và
biến thể đã tạo, mỗi staff được phân công tối đa 5 đơn đang mở.
Các kiểm tra offline không thay thế ràng buộc index trên dữ liệu Atlas hiện có;
seed giữ nguyên index và rollback toàn bộ transaction nếu ghi thất bại.
Ảnh dùng URL mẫu từ Faker, không tạo tài nguyên Cloudinary giả.
Không seed `SystemLock` và `ImageCleanupJob` vì đây là dữ liệu vận hành nội bộ.

Các file triển khai: `src/seeds/generate.ts` tạo/validate dữ liệu;
`src/seeds/run.ts` xử lý CLI, kết nối và transaction.

## Sửa tên dữ liệu đã seed

Không cần seed thêm để sửa dữ liệu cũ. Build rồi xem trước các thay đổi:

```powershell
pnpm.cmd build
node dist/seeds/clean-names.js
```

Để áp dụng:

```powershell
node dist/seeds/clean-names.js --apply
```

Lệnh chỉ nhận diện tên có hậu tố UUID/mã seed cũ và slug có cùng hậu tố.
Lệnh cũng sửa slug `seed-product-...`, `seed-category-...`, `seed-brand-...`
khi tên đã được làm sạch. Slug luôn được tạo bằng `buildSlug(tên)` cho cả ba module.
Tên và slug được làm gọn, thêm số nếu trùng với dữ liệu hiện có.
Lệnh giữ nguyên ID, liên kết, tài khoản, tồn kho và index; cập nhật cả tên snapshot
trong order item khi khớp productId và tên cũ. Thay đổi nằm trong một transaction.
Slug sản phẩm sẽ đổi, nên URL storefront dùng slug cũ cần được cập nhật.
Chạy lại sau khi đã sửa sẽ không tìm thấy tên cũ để đổi tiếp.
