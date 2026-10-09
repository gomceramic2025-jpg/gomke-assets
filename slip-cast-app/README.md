# Gốm Kể · Tạo khuôn đổ rót

Mở file `index.html` bằng trình duyệt (chạy offline, không cần cài gì).

Quy trình: tải phôi STL/OBJ → chọn số mảnh & góc chia → kiểm tra vùng undercut → "Tạo khuôn" → xuất STL.

2 mảnh dạng hộp: xuất "Hộp đổ" (in 3D), đặt mặt sàn xuống bàn in, đổ thạch cao tới mép tường là ra nửa khuôn có lỗ định vị.

Sửa code: `npm install` rồi `node build.mjs` để đóng gói lại `index.html`.

## Kiểm tra tự động (thư mục test/)
- `audit_node.mjs`, `audit_perf.mjs`: thử logic khuôn/hộp bao với trường hợp biên và phôi nhiều mặt.
- `audit_ui.mjs`, `audit_ui2.mjs`, `audit_ui3.mjs`: thử giao diện bằng Chromium (file lỗi, giá trị sai, đổi nhanh, điện thoại, đổi tab).
- `ui7.mjs`, `ui10.mjs`: thử luồng đầy đủ với bình xoắn và tượng gấu.
