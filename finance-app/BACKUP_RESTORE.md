# Sao lưu và khôi phục

## Định dạng `.gomke-fin`
JSON: `format, version, schemaVersion, createdAt, counts, checksum(SHA-256 của dữ liệu rõ), encrypted, sealed|data, envelopes`.
- Có khóa trên thiết bị → toàn bộ dữ liệu mã hóa AES-256-GCM, kèm envelope (DEK bọc bằng khóa khôi phục) ⇒ **máy mới chỉ cần khóa khôi phục**. Khóa không nằm trong tệp.
- Chưa có khóa → tệp **không mã hóa** (giao diện cảnh báo).
- Gồm cả mục trong thùng rác và tombstone. Không gồm outbox/khóa.

## Sao lưu cục bộ
- Nút **Sao lưu ngay** (tạo bản trong IndexedDB + tải tệp). Tự động mỗi ngày **khi ứng dụng đang mở** (kiểm tra mỗi giờ; bản tốt gần nhất > 24 giờ thì tạo).
- Mỗi bản được đọc lại, giải mã thử và đối chiếu checksum trước khi tính là "tốt"; giữ N bản tốt (mặc định 7). Bản lỗi được ghi nhận và **không** xóa bản tốt.
- **Trình duyệt không chạy nền khi ứng dụng đã đóng.** Ứng dụng không tuyên bố có sao lưu nền. Chưa cung cấp tiện ích máy tính chạy nền; nếu cần, dùng tệp tải về/Drive hoặc nhờ phát triển thêm một tác vụ lập lịch riêng.
- Sao lưu cục bộ nằm cùng trình duyệt với dữ liệu: xóa dữ liệu trình duyệt thì mất cả hai → hãy tải tệp ra ngoài.

## Khôi phục
1. Chọn bản cục bộ / tệp / bản trên Drive.
2. Xem thông tin: thời điểm, mã hóa, số lượng; cảnh báo nếu bản sao lưu **cũ hơn** dữ liệu hiện tại.
3. Chọn: **Thay thế** (về đúng bản sao lưu; phần mới hơn vào thùng rác) hoặc **Gộp** (chỉ thêm ID chưa có ⇒ không nhân đôi giao dịch).
4. Xác nhận. Ứng dụng tự tạo bản an toàn của trạng thái hiện tại trước, kiểm tra tệp, rồi ghi trong **một giao dịch** — lỗi giữa chừng thì dữ liệu hiện tại giữ nguyên.
5. Máy mới/mất khóa: nhập khóa khôi phục khi được hỏi.
Sau khôi phục, các bản ghi bị chạm được đưa vào hàng đợi đồng bộ.

## Google Drive (tùy chọn)
Chỉ scope `drive.appdata`; token chỉ trong bộ nhớ; mặc định chỉ tải bản mã hóa; mỗi lần một tệp mới (không ghi đè); tải về đối chiếu hash rồi mới dọn bản cũ (giữ 10); khôi phục qua cùng quy trình trên. Cần `VITE_GOOGLE_CLIENT_ID` (xem `docs/SETUP_GOOGLE_OAUTH.md`). Đã kiểm thử với Drive giả; **chưa** thử với Drive thật.

## Xuất dữ liệu
Báo cáo → CSV (UTF-8 BOM), Excel, và In → Lưu PDF.

## Bản sao trên Supabase không phải bản sao lưu duy nhất
Nó chỉ là bản mã; không thay thế khóa khôi phục và bản sao cục bộ/ngoại tuyến.
