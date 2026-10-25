# Backend API quản lý bán hàng

Bản hướng dẫn tiếng Việt tương ứng với [README.md](README.md). Dự án xây dựng RESTful API bằng Node.js, Express 5, TypeScript và MongoDB thông qua Mongoose. Khi thay đổi mã nguồn, tuân thủ [AGENTS.md](AGENTS.md).

## 1. Chuẩn bị môi trường

- Node.js tương thích với các thư viện đang cài đặt; phiên bản đã được kiểm tra trước đó là **24.16.0**.
- **pnpm 11.9.0** theo cấu hình dự án.
- MongoDB chạy dưới dạng **replica set hoặc sharded cluster**. Có thể dùng replica set một node ở máy local hoặc MongoDB Atlas.

MongoDB standalone không hỗ trợ các transaction mà ứng dụng sử dụng cho bootstrap, đơn hàng, tồn kho và bảo vệ quan hệ dữ liệu. Ứng dụng kiểm tra điều kiện này khi khởi động.

## 2. Chạy ở môi trường development

### Cài đặt thư viện

```sh
pnpm install
```

Trên Windows, nếu PowerShell chặn file `pnpm.ps1`, thay `pnpm` bằng `pnpm.cmd` trong các lệnh dưới đây.

### Cấu hình môi trường

Sao chép `.env.example` thành `.env` nếu chưa có, rồi điền:

| Biến | Vai trò |
| --- | --- |
| `MONGODB_URI` | Chuỗi kết nối cơ sở dữ liệu của ứng dụng |
| `JWT_SECRET` | Khóa ký access token |
| `JWT_REFRESH_SECRET` | Khóa ký refresh token, phải khác `JWT_SECRET` |
| `PORT` | Cổng backend; mặc định là `5000` |
| `BOOTSTRAP_SECRET` | Khóa riêng dùng khi tạo quản trị viên đầu tiên |

Nên dùng khóa ngẫu nhiên mạnh, ít nhất 32 byte cho mỗi khóa JWT. Không commit `.env`, mật khẩu, token hoặc chuỗi kết nối thật vào Git.

### Khởi động backend

```sh
pnpm dev
```

Ứng dụng kết nối MongoDB thành công trước khi mở cổng HTTP. Các API chính có tiền tố `/api/v1`.

### Tạo quản trị viên đầu tiên

Gửi `POST /api/v1/auth/bootstrap` với header `x-bootstrap-secret` trùng với `BOOTSTRAP_SECRET` và body JSON phẳng:

```json
{
  "email": "admin@example.com",
  "password": "THAY_BANG_MAT_KHAU_RIENG",
  "firstName": "Admin",
  "lastName": "System"
}
```

Bootstrap trả `403` khi chưa cấu hình khóa, gửi sai khóa hoặc hệ thống đã được khởi tạo. Khóa đánh dấu trong cơ sở dữ liệu ngăn tạo admin đầu tiên đồng thời và ngăn bootstrap lại sau khi tài khoản bị xóa. Sau khi khởi tạo thành công, bỏ `BOOTSTRAP_SECRET` khỏi cấu hình môi trường.

Ứng dụng không tự chạy bootstrap hoặc chuyển đổi dữ liệu khi khởi động.

## 3. Test API bằng REST Client

Mở hai terminal:

```sh
# Terminal 1: backend
pnpm dev
```

```sh
# Terminal 2: proxy phục vụ REST Client
pnpm rest-client
```

Backend mặc định ở cổng `5000`; các file `.http` gọi proxy local ở cổng `5001`. Proxy chỉ phục vụ kiểm thử local, không dùng cùng production server.

1. Tạo `REST_CLIENT/.env` theo [file mẫu](REST_CLIENT/.env.example) nếu chưa có.
2. Điền tài khoản vào `LOGIN_EMAIL`, `LOGIN_PASSWORD`.
3. Gửi request **login** trong [auth.http](REST_CLIENT/auth.http).
4. Sau khi đăng nhập thành công, proxy lưu `ACCESS_TOKEN`, `REFRESH_TOKEN`, `USER_ID` vào file môi trường dùng chung.
5. Chuyển sang các file HTTP còn lại để kiểm thử; không cần sao chép token thủ công.

Các request dùng header chuẩn `Authorization: Bearer {{$dotenv ACCESS_TOKEN}}`. Header `x-rest-client-auth: primary` yêu cầu proxy đọc token mới nhất từ file môi trường; backend vẫn xác thực qua `Authorization`.

Các ID cũng được đọc từ `REST_CLIENT/.env`. Tạo tài nguyên thành công sẽ cập nhật ID tương ứng. `PARENT_CATEGORY_ID` dùng riêng cho danh mục cha; customer thứ hai và thứ ba có `CUSTOMER_2_ID`, `CUSTOMER_3_ID` riêng. Chọn đúng bản ghi trước khi cập nhật hoặc xóa.

Thứ tự tạo dữ liệu thuận tiện: **brand → category → product → customer → order**. Mỗi luồng hoàn tất hoặc hủy cần một đơn hàng mới. Không dùng **Send All Requests** trên dữ liệu thật.

Access token hết hạn thì gửi **refresh** hoặc đăng nhập lại. Session staff dùng tài khoản khác và các biến `STAFF_ACCESS_TOKEN`, `STAFF_REFRESH_TOKEN` riêng. Mỗi tài khoản chỉ có một refresh session.

Xem thêm [hướng dẫn REST Client](REST_CLIENT/README.md) về request, session và xử lý lỗi.

## 4. Quy ước API và xác thực

Các interface/type được khai báo tường minh trong `src/types`, gồm kiểu dữ liệu lưu trữ và DTO cho các thao tác tạo, cập nhật, truy vấn. Schema trong `src/validations` dùng Zod 4 để kiểm tra dữ liệu lúc chạy và `satisfies z.ZodType<DTO>` để kiểm tra tính tương thích với DTO khi biên dịch. Các tầng service/controller lấy kiểu từ `src/types`; file validation vẫn re-export kiểu để tương thích các import cũ.

Lưu ý phân biệt dữ liệu trước và sau validation: chẳng hạn `ProductInput` cho phép bỏ qua `discount`, `is_active`, `variants`, còn `CreateProductInput` yêu cầu những trường này vì Zod đã điền giá trị mặc định. Việc kiểm tra schema và ràng buộc trong Mongoose vẫn được giữ riêng theo vai trò của từng lớp.

- Response JSON dùng các trường `success`, `statusCode`, `message`, `data`. Lỗi validation có thể có `errors`; danh sách có thể có `pagination`. Trường `meta` cũ của user được giữ để tương thích.
- Danh sách accounts/users hỗ trợ tìm kiếm không phân biệt hoa thường hoặc dấu tiếng Việt qua `GET /api/v1/users?search=<từ khóa>&page=1&limit=10`. Có thể tìm theo email, tên, họ hoặc nhập nhiều từ trong tên đầy đủ; kết quả vẫn được phân trang.
- Danh sách sản phẩm dùng `page`, `limit`, mặc định lần lượt là `1`, `10`. Muốn lấy toàn bộ phải duyệt các trang.
- Body auth/user là JSON phẳng. Các trường không thuộc schema được loại bỏ; khoảng trắng trong mật khẩu được giữ nguyên.
- Refresh token được lưu dưới dạng hash SHA-256 và thay mới bằng thao tác cập nhật có điều kiện. Response user không trả mật khẩu, refresh token hay phiên bản session.
- Đăng xuất, đổi mật khẩu, vô hiệu hóa tài khoản hoặc đổi quyền sẽ thu hồi session theo logic phiên bản token. Token cũ không tương thích cần đăng nhập lại.
- Tài khoản dùng bcrypt được xác minh và nâng cấp sang Argon2id sau khi đăng nhập đúng. Tài khoản cũ thiếu `active` được bổ sung `active: true` khi đăng nhập thành công; `active: false` hoặc `null` vẫn bị chặn.
- Việc nâng cấp hash, bổ sung `active` và lưu refresh session nằm trong cùng một cập nhật có điều kiện. Thay đổi mật khẩu hoặc vô hiệu hóa tài khoản đồng thời sẽ ngăn lần đăng nhập đó hoàn tất.
- Mật khẩu bcrypt nhập vào dài hơn **72 byte UTF-8** bị từ chối vì bcrypt không xác minh được phần vượt giới hạn. Tài khoản thuộc trường hợp này cần quản trị viên hỗ trợ đổi mật khẩu. Tài khoản mới và thao tác đổi mật khẩu dùng Argon2.
- Login/bootstrap/refresh dùng chung giới hạn **30 lần gọi cho mỗi IP trong 15 phút trên mỗi tiến trình**. Khi bị giới hạn, API trả `429` và `Retry-After`. Proxy local dùng chung IP loopback. Nếu triển khai nhiều tiến trình API, cần giới hạn dùng chung tại gateway.

## 5. Quy tắc nghiệp vụ và toàn vẹn dữ liệu

### User, customer và danh mục

- Không thể xóa, hạ quyền hoặc vô hiệu hóa admin đang hoạt động cuối cùng.
- Phải phân công lại các đơn đang mở trước khi vô hiệu hóa nhân viên phụ trách.
- Không thể xóa user, customer hoặc product đã được đơn hàng tham chiếu.
- Không thể xóa brand/category đang được product tham chiếu; có thể vô hiệu hóa để ngừng sử dụng cho giao dịch mới.
- Brand/category bị xóa hoặc không hoạt động không được dùng khi tạo sản phẩm hoặc đơn hàng mới.
- Danh mục cha phải tồn tại và không được tạo vòng lặp. Khi xóa danh mục chưa được sản phẩm sử dụng, việc gỡ liên kết cha của các danh mục con nằm trong cùng transaction.

### Sản phẩm, biến thể và tồn kho

- ID biến thể phải thuộc đúng sản phẩm và không được trùng trong mảng.
- Gửi `variants` nghĩa là thay thế mảng biến thể. Cần gửi `_id` hiện có để giữ danh tính của biến thể muốn giữ lại.
- Với biến thể hiện có, các trường stock, ảnh, thuộc tính không gửi lên sẽ giữ giá trị cũ.
- Tồn kho phải là số nguyên an toàn, không âm. Sản phẩm có biến thể phải có tổng tồn kho bằng tổng stock của các biến thể.
- Khi bỏ toàn bộ biến thể, có thể gửi stock cho sản phẩm đơn; nếu không gửi, giữ tổng tồn kho hiện tại.
- Đơn hàng đang mở ngăn xóa biến thể đã được đặt hoặc chuyển sản phẩm đơn đã được đặt sang dạng có biến thể.
- Cơ chế optimistic concurrency giúp phát hiện xung đột khi lưu sản phẩm. Khi nhận `409`, đọc lại trạng thái hiện tại trước khi thử lại.

### Đơn hàng

| Phương thức | Đường dẫn | Chức năng |
| --- | --- | --- |
| `POST` | `/api/v1/orders` | Tạo đơn hàng |
| `GET` | `/api/v1/orders` | Danh sách, phân trang và lọc |
| `GET` | `/api/v1/orders/:id` | Xem chi tiết |
| `PATCH` | `/api/v1/orders/:id/status` | Đổi trạng thái |
| `PATCH` | `/api/v1/orders/:id/assignee` | Admin phân công lại đơn đang mở |
| `DELETE` | `/api/v1/orders/:id` | Xóa đơn đã bị từ chối/hủy |

Luồng trạng thái hợp lệ:

```text
Pending (1) → Processing (2) → Completed (4)
Pending (1) hoặc Processing (2) → Rejected (3)
```

Completed và Rejected là trạng thái kết thúc. Không thể chuyển tiếp trạng thái của những đơn này; cần tạo đơn mới để test luồng khác. Chỉ đơn Rejected được xóa.

- Mỗi dòng hàng nhận `{ productId, variantId?, quantity }`. Sản phẩm có biến thể bắt buộc có `variantId`; sản phẩm đơn chỉ cần `productId`.
- Server lấy giá, SKU từ dữ liệu sản phẩm/biến thể và lưu tại thời điểm đặt hàng; giá do client gửi không được dùng để tính đơn.
- Đơn mới lưu thêm tên, email, số điện thoại khách hàng tại thời điểm tạo. Đơn cũ không được tự bổ sung dữ liệu này.
- Tạo đơn và trừ kho nằm trong cùng transaction. Chuyển sang Rejected và hoàn kho cũng nằm trong cùng transaction; nếu hoàn kho thất bại, trạng thái và tồn kho không được ghi dở dang.
- Đơn cũ thiếu `variantId` nhưng sản phẩm hiện có biến thể cần đối soát thủ công trước khi hủy; API trả `409` thay vì tự đoán biến thể để hoàn kho.
- Processing và Completed yêu cầu người phụ trách đang hoạt động. API `/assignee` cho phép admin đổi người phụ trách đơn Pending/Processing mà không đổi trạng thái.
- `requireDate` không được trước lúc tạo đơn. `shippingDate` là thời điểm hoàn tất: chỉ nhận khi chuyển sang Completed, nằm từ thời điểm tạo đơn đến hiện tại.
- Tổng tiền làm tròn từng dòng sau giảm giá đến hai chữ số thập phân, theo quy tắc nửa lên, bằng phép tính số nguyên. Giá trị vượt phạm vi tiền tệ an toàn bị từ chối.

### Xử lý các request đồng thời

Các thao tác thay đổi quan hệ dữ liệu, sửa tồn kho, tạo/cập nhật/phân công đơn và thay đổi user cần bảo vệ dùng chung một khóa trong transaction. Khóa giúp ngăn request đồng thời vượt qua kiểm tra tham chiếu, tạo vòng lặp danh mục hoặc làm mất admin cuối cùng.

Cơ chế này tuần tự hóa các thao tác ghi liên quan giữa các tiến trình API. Khi cần tăng thông lượng, cần thiết kế khóa hẹp hơn nhưng vẫn giữ các điều kiện toàn vẹn. Script bảo trì và thao tác ghi trực tiếp lên cơ sở dữ liệu cũng phải tuân thủ các quy tắc này.

## 6. Kiểm thử, kiểm tra kiểu và build

```sh
pnpm test
pnpm typecheck
pnpm build
```

Sau khi build, chạy bản biên dịch bằng:

```sh
pnpm start
```

| Lệnh | Phạm vi |
| --- | --- |
| `pnpm test` | Biên dịch TypeScript rồi chạy unit test và HTTP test bằng Node test runner |
| `pnpm typecheck` | Kiểm tra kiểu TypeScript, không xuất file biên dịch |
| `pnpm build` | Biên dịch mã nguồn vào `dist` |
| `pnpm test:integration` | Kiểm thử transaction trên MongoDB replica set dành riêng cho test |

Unit/HTTP test mở server ở cổng local tạm thời và mock thao tác model, không kết nối cơ sở dữ liệu thật. Chúng kiểm tra validation, quyền truy cập, session, tồn kho, trạng thái và luân chuyển token; **không chứng minh khả năng rollback hoặc cô lập transaction của MongoDB**. Test khởi động dùng một địa chỉ MongoDB local cố tình không khả dụng để kiểm tra ứng dụng thoát khi kết nối thất bại.

Để chạy integration, đặt `MONGODB_TEST_URI` trỏ đến MongoDB replica set dành riêng cho kiểm thử, rồi chạy:

```sh
pnpm test:integration
```

Nhóm test này không đọc chuỗi kết nối từ `.env` của ứng dụng. Nó tạo cơ sở dữ liệu có tên ngẫu nhiên dạng `codex_test_*` và dọn các bản ghi fixture do lần chạy tạo ra. Nội dung kiểm tra gồm rollback, chống bán vượt tồn, hoàn kho đúng một lần, thay đổi admin đồng thời, vòng lặp danh mục và xung đột giữa xóa danh mục/tạo sản phẩm.

Workflow [verify.yml](.github/workflows/verify.yml) cấu hình chạy typecheck, unit/HTTP test, build và integration trên MongoDB replica set local tách biệt. Có file workflow chưa đồng nghĩa CI đã chạy thành công; cần xem kết quả sau khi push. Kết quả kiểm thử phụ thuộc lần chạy và phiên bản mã nguồn, không phải cam kết cố định của tài liệu.

## 7. Lưu ý vận hành

- Ở production, ứng dụng tắt tự động tạo index. Cần chuẩn bị các index theo schema trong quy trình triển khai.
- Khi nhận tín hiệu dừng, server đóng kết nối HTTP và ngắt kết nối MongoDB.
- Script build dừng khi gặp lỗi; không xem dòng thông báo kết thúc là bằng chứng build thành công nếu lệnh đã thất bại.
- Không tự chạy bootstrap, migration hoặc request thay đổi dữ liệu thật chỉ để kiểm tra ứng dụng.

## 8. Tài liệu liên quan

- [README gốc](README.md): hướng dẫn bằng tiếng Anh.
- [AGENTS.md](AGENTS.md): quy tắc phát triển và làm việc với dự án.
- [REST_CLIENT/README.md](REST_CLIENT/README.md): hướng dẫn test API bằng REST Client.
- [MD/AdminDashboard.md](MD/AdminDashboard.md): tài liệu dashboard quản trị.
