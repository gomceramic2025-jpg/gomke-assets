# Cài ứng dụng lên iPhone (PWA)

Yêu cầu: ứng dụng được host qua **HTTPS** (Web Crypto, service worker và đăng nhập không chạy được trên HTTP ngoài localhost). iOS 16.4+ khuyến nghị.

1. Mở địa chỉ ứng dụng bằng **Safari** (không phải Chrome trong ứng dụng khác).
2. Nút **Chia sẻ** → **Thêm vào Màn hình chính** → Thêm.
3. Mở ứng dụng từ biểu tượng mới. Đăng nhập Google, vào **Đồng bộ thiết bị**, nhập khóa khôi phục.
4. Lưu ý iOS: nếu không dùng ứng dụng nhiều tuần, iOS có thể xóa dữ liệu trang web. Hãy đồng bộ lên máy chủ và có bản sao lưu `.gomke-fin` ngoài thiết bị. "Chia sẻ → In" dùng để lưu báo cáo PDF.
5. Kiểm tra: tắt Wi-Fi/4G, mở app, thêm một giao dịch (vẫn lưu được), bật mạng → trạng thái chuyển "Đã đồng bộ".

Trạng thái kiểm thử: PWA đã được kiểm thử trên Chromium (manifest, icon, service worker, mở lại khi ngoại tuyến). **Chưa kiểm thử trên iPhone/Safari thật.**
