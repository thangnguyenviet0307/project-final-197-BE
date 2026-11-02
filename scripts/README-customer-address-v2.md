# Địa chỉ nhận hàng v2 và đồng bộ hồ sơ

Nguồn duy nhất: `https://provinces.open-api.vn/api/v2/?depth=2`, tỉnh/thành và phường/xã sau sáp nhập. Không gọi hoặc fallback sang API địa phương v1. BE cache/coalesce trong 24 giờ; lỗi provider không dùng địa chỉ tự đoán.

## Quy tắc dữ liệu

- Tên hiển thị là `lastName firstName`; không đổi vị trí dữ liệu trong hai field MongoDB.
- `shippingAddress` lưu đầy đủ người nhận, email nhận hàng, thời gian giao, địa chỉ và `addressVersion: 2`, `provinceCode`, `wardCode`.
- `address` là bản tương thích của cùng địa chỉ: `street = shippingAddress.street`, `city = shippingAddress.ward`, `state = shippingAddress.province`.
- Lưu địa chỉ trong tài khoản hoặc chỉnh address qua API quản lý cập nhật cả hai object trong cùng lệnh ghi. Mã và quan hệ tỉnh/phường được xác minh bằng v2; tên địa phương lấy từ server. Địa chỉ dạng text chỉ được chuyển khi tên khớp duy nhất trong v2.
- Checkout lấy hồ sơ hiện tại để điền sẵn. Sau khi một đơn mới của Customer được tạo thành công, cập nhật số điện thoại và cả hai object trong cùng transaction với đơn/tồn/receipt. Không thay đổi tên/email đăng nhập. Giữ email nhận hàng và giờ giao đã lưu khi checkout không có ô nhập tương ứng.
- Đơn thất bại, mua Guest, request phát lại hoặc hủy đơn không ghi đè địa chỉ hồ sơ. Không sửa snapshot của đơn cũ khi hồ sơ đổi.
- Form có dữ liệu mới sẽ làm mới phần chưa sửa; phần đang dirty được giữ nguyên.

## Checkout mới

Giữ endpoint API ứng dụng `/api/v1/customer-auth/orders` (hoặc Guest `/api/v1/storefront/checkout`). `/api/v1` của ứng dụng không phải phiên bản bộ dữ liệu địa phương.

Payload địa phương mới có `addressVersion: 2`, `provinceCode`, `wardCode`; không gửi `districtCode`. Cấu trúc requestId/COD/items/giá kỳ vọng không đổi.

Receipt cũ đã commit được trả lại trước khi tra địa phương, giữ đúng fingerprint cũ để không tạo trùng. Request cũ chưa commit bị từ chối 400 và không giữ tồn; khách phải chọn địa chỉ mới. Không gọi v1 để giải quyết các request này.

## Dữ liệu đã tồn tại trong Atlas

Deploy BE và FE cùng thay đổi này. Tài khoản đã có địa chỉ cũ: vào Địa chỉ của tôi, chọn tỉnh/thành và phường/xã mới rồi lưu. Kiểm tra cùng document Customer: cả `address` và `shippingAddress` phải có cùng nội dung địa chỉ theo mapping trên. Sau đó mở checkout phải điền sẵn địa chỉ vừa lưu; đặt đơn với địa chỉ khác rồi mở lại hồ sơ phải thấy địa chỉ mới.

Không tự đổi `Quận 1` thành một phường mới: một quận cũ có thể tương ứng nhiều phường. Khi không khớp duy nhất, giữ dữ liệu cũ để tham khảo và yêu cầu khách chọn lại. Không chạy migration/ghi đè hàng loạt Atlas trong tác vụ code này.

Ngày sinh có ô chọn năm trực tiếp và ô ngày/tháng/năm. Đổi năm của ngày 29/02 sang năm không nhuận sẽ về 28/02; không cho ngày trong tương lai.

## Kiểm tra

Chạy BE `pnpm.cmd typecheck`, `pnpm.cmd test`; FE `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd test`, `pnpm.cmd test:contracts`, `pnpm.cmd build`. Integration transaction cần replica set test riêng, không chạy trên DB đang dùng. Kiểm tra thủ công sau deploy: lưu hồ sơ → checkout; checkout thành công → hồ sơ; checkout lỗi/retry → không đổi hồ sơ; Guest → không sửa Customer; đơn cũ → snapshot không đổi.
