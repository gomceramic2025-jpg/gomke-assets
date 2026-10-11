# Thiết kế đồng bộ

## Luồng
1. Ghi vào IndexedDB trước; đồng thời đặt bản ghi vào `outbox` {collection, id, opId, baseRev}. Dữ liệu mẫu không vào outbox.
2. Khi có mạng + đã đăng nhập + có khóa: với từng mục outbox → `seal` (AES-GCM) bản ghi trên thiết bị → `push_record(opId, baseRev, payload)`.
3. Máy chủ (khóa advisory theo người dùng): nếu `opId` đã xử lý → trả kết quả cũ (**idempotent**); nếu `rev` hiện tại ≠ `baseRev` → trả **conflict** + bản hiện tại (không ghi đè); ngược lại `rev+1`, `seq` mới.
4. Chỉ khi máy chủ trả `ok` thì mới xóa khỏi outbox và ghi `syncMeta.serverRev`. Nếu người dùng sửa tiếp trong lúc gửi (opId mới), mục outbox được giữ lại với `baseRev` mới.
5. Kéo: `seq > cursor` theo trang 200; giải mã cục bộ; kiểm tra Zod; áp dụng. Bản ghi đã biết (`serverRev ≥ rev`) bị bỏ qua.
6. Mất mạng: mục outbox ở nguyên; thử lại 5s, 10s, 20s… tối đa 300s, khi `online`, khi tab hiện lại và mỗi 60s.

## Trạng thái hiển thị
Đã đồng bộ · Đang đồng bộ · Chờ kết nối · Đồng bộ thất bại · Có xung đột cần xử lý (+ Cần đăng nhập lại, Chưa có khóa). "Đã đồng bộ" chỉ khi outbox rỗng sau khi máy chủ xác nhận và kéo thành công.

## Phiên bản, tombstone, xung đột
- Mỗi bản ghi có `rev` cục bộ (lịch sử) và `serverRev` (quyền quyết định xung đột).
- Xóa mềm là bản ghi có `deletedAt` (vẫn đồng bộ đầy đủ → khôi phục được ở mọi máy). Xóa vĩnh viễn là tombstone `purged` (nội dung bị bỏ), máy chủ đánh dấu `deleted`.
- Xung đột khi: máy chủ đã đổi so với `baseRev` **và** nội dung khác bản cục bộ (so sánh bỏ qua rev/timestamp; nếu giống hệt thì tự gộp, ví dụ hai máy cùng khởi tạo danh mục mặc định).
- Không "bản mới nhất thắng". Xung đột được lưu (`conflicts`) và người dùng chọn: giữ bản này / dùng bản kia / (giao dịch) giữ cả hai (bản kia thành giao dịch mới có ghi chú). Quyết định được ghi vào lịch sử.
- Máy ngoại tuyến lâu ngày: kéo theo con trỏ nên bắt kịp mọi thay đổi; nếu nó sửa bản ghi mà nơi khác đã sửa/xóa → xung đột; nếu nó không sửa thì nhận bản mới (không "sống lại" giao dịch đã xóa).
- Dữ liệu bị sửa/hoán đổi trên máy chủ: AEAD+AAD phát hiện, bản ghi bị bỏ qua và báo lỗi, không làm hỏng dữ liệu cục bộ.

## Khóa trong đồng bộ
Bản ghi mang `key_version`. Gặp phiên bản chưa có khóa → thử "chain" tự động; không được → trạng thái "Chưa có khóa" và yêu cầu nhập khóa khôi phục.

## Đã kiểm chứng
21 test đồng bộ hai thiết bị (máy chủ giả cùng quy tắc) + 14 test SQL thật trên PostgreSQL (PGlite). **Chưa** chạy với Supabase thật.
