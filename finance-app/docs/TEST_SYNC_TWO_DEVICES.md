# Kiểm thử đồng bộ hai thiết bị thật (bạn thực hiện)

Điều kiện: đã làm xong `SETUP_SUPABASE.md`, host HTTPS, có máy tính + iPhone.

1. **Máy tính**: đăng nhập → Đồng bộ thiết bị → *Tạo khóa mã hóa* → lưu khóa khôi phục → thêm 1 giao dịch → *Đồng bộ ngay* → trạng thái "Đã đồng bộ".
2. **Xác minh bản mã**: Supabase → Table editor → `sync_records`: cột `payload` phải là JSON `{"v":1,"kv":1,"n":…,"c":…}`, **không** thấy số tiền/nội dung.
3. **iPhone**: cài PWA, đăng nhập, nhập khóa khôi phục → giao dịch xuất hiện (máy tính → iPhone).
4. Thêm giao dịch trên iPhone → *Đồng bộ ngay* → mở máy tính → xuất hiện (iPhone → máy tính).
5. **Mất mạng**: bật chế độ máy bay trên iPhone, thêm giao dịch (thấy "Chờ đồng bộ"), tắt chế độ máy bay → tự đồng bộ.
6. **Xung đột**: tắt mạng cả hai, sửa *cùng* một giao dịch ở hai nơi với số tiền khác nhau, bật mạng lần lượt → máy thứ hai phải hiện "Có xung đột cần xử lý" và cho chọn.
7. **Xóa vs sửa**: xóa ở máy A, sửa ở máy B khi offline → xung đột (không tự sống lại).
8. **Đăng nhập lại**: đăng xuất → thay đổi cục bộ vẫn ở hàng đợi → đăng nhập lại → đồng bộ.
9. **Người lạ**: đăng nhập bằng tài khoản Google khác → phải bị từ chối.
Ghi kết quả vào `TEST_REPORT.md` mục "Việc chủ sở hữu kiểm thử".
