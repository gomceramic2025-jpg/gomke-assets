# Xử lý sự cố đồng bộ

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| "Chưa cấu hình đồng bộ" | Thiếu `VITE_SUPABASE_*` lúc **build** | Điền `.env.local`, build lại |
| "Chưa có khóa mã hóa" | Thiết bị mới | Máy đầu tiên: *Tạo khóa*. Máy khác: *Thêm thiết bị bằng khóa khôi phục* (không tạo khóa mới!) |
| "Khóa khôi phục không đúng" | Gõ sai/khóa của lần đổi khóa trước | Dùng khóa mới nhất; khóa có 56 ký tự, phân biệt 0/O, 1/I/L được tự chuẩn hóa |
| "Cần đăng nhập lại" | Phiên hết hạn / tài khoản không nằm trong `allowed_owners` | Đăng nhập lại; kiểm tra email trong `allowed_owners` |
| "Chờ kết nối" | Mất mạng | Thay đổi nằm trong hàng đợi, tự gửi lại |
| "Đồng bộ thất bại" | Lỗi máy chủ (xem chi tiết dưới nút) | Tự thử lại 5s→5 phút; kiểm tra Supabase Logs |
| "Có xung đột cần xử lý" | Hai nơi sửa cùng bản ghi | Đồng bộ thiết bị → chọn bản đúng |
| "Bản ghi … không giải mã được/bị sửa đổi" | Dữ liệu trên máy chủ bị thay đổi, hoặc khóa khác | Bản ghi bị bỏ qua, dữ liệu cục bộ không bị hỏng; đối chiếu, khôi phục từ sao lưu |
| Mất khóa khôi phục nhưng còn thiết bị đang mở khóa | — | Trên thiết bị đó: *Đổi khóa* → lưu khóa khôi phục MỚI |
| Mất cả khóa và thiết bị | Không thể khôi phục dữ liệu mã hóa | Khôi phục từ tệp sao lưu **không mã hóa** (nếu có); nếu không thì nhập lại |
| iPhone mất dữ liệu | iOS dọn dữ liệu web lâu ngày không dùng | Nhập khóa khôi phục, đồng bộ lại từ máy chủ |
