# Liên hệ khách vãng lai

- Checkout không đăng nhập yêu cầu email, tên người nhận, điện thoại và địa chỉ V2. Email được chuẩn hóa chữ thường. Điện thoại được đối chiếu theo định dạng nội địa / +84.
- Liên hệ được lưu trong `guest_contacts`, có unique index email và phoneKey. Không tạo mật khẩu, phiên đăng nhập hoặc tài khoản Customer. Khởi động BE tạo index cho collection mới; không chạy migration dữ liệu cũ.
- Đối chiếu email HOẶC điện thoại. Khi khớp, giữ nguyên cả email và số điện thoại của liên hệ hiện có; chỉ cập nhật tên người nhận và địa chỉ. Hai định danh trỏ tới hai người khác nhau, hoặc số điện thoại khớp nhiều tài khoản, trả 409 để kiểm tra lại.
- Nếu khớp tài khoản đã đăng ký, chỉ lưu thông tin nhận hàng chưa xác minh trong CRM và hiển thị tại quản trị khách hàng. Không ghi đè hồ sơ đăng nhập, mật khẩu hay phiên của tài khoản đó bằng dữ liệu khách vãng lai.
- Quản trị khách hàng hiển thị cả tài khoản và liên hệ vãng lai, kèm nhãn phân biệt. Đơn khách vãng lai liên kết bằng `contactCustomerId`; `customerId` vẫn null. Lịch sử riêng trên storefront không tự nhận đơn vãng lai dựa vào email.
- Ghi liên hệ, giữ tồn, đơn hàng và biên nhận cùng transaction. Gửi lại requestId đã thành công trả biên nhận trước bước cập nhật liên hệ. Biên nhận cũ thiếu email vẫn phát lại được; đơn mới phải nhập email.
- Deploy cả FE và BE. Không tự bổ sung email hay liên hệ cho đơn cũ. Kiểm tra transaction trên MongoDB replica set dành riêng cho test bằng `pnpm.cmd test:integration` với `MONGODB_TEST_URI`; không dùng Atlas production.
- Index lịch sử `orders.contactCustomerId + orderDate` được khai báo trong schema. Audit/apply bằng công cụ core-index hiện có theo quy trình duyệt database; không tự chạy thay đổi index trên production.
