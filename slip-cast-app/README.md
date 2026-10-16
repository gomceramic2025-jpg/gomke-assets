# Gốm Kể · Tạo khuôn đổ rót

Mở file `index.html` bằng trình duyệt (chạy offline, không cần cài gì).

Quy trình: tải phôi STL/OBJ → chọn số mảnh & góc chia → kiểm tra vùng undercut → "Tạo khuôn" → xuất STL.

2 mảnh dạng hộp: xuất "Hộp đổ" (in 3D), đặt mặt sàn xuống bàn in, đổ thạch cao tới mép tường là ra nửa khuôn có lỗ định vị.

Sửa code: `npm install` rồi `node build.mjs` để đóng gói lại `index.html`.

## Kiểm tra tự động (thư mục test/)
- `audit_node.mjs`, `audit_perf.mjs`: thử logic khuôn/hộp bao với trường hợp biên và phôi nhiều mặt.
- `audit_ui.mjs`, `audit_ui2.mjs`, `audit_ui3.mjs`: thử giao diện bằng Chromium (file lỗi, giá trị sai, đổi nhanh, điện thoại, đổi tab).
- `ui7.mjs`, `ui10.mjs`: thử luồng đầy đủ với bình xoắn và tượng gấu.
- `repair.mjs`, `make_broken.mjs`, `worker_ui.mjs`, `box_worker.mjs`: thử tự vá lưới hở, luồng nền (Worker), nút Hủy, đổi phôi giữa chừng, chế độ dự phòng khi không có Worker.

## Cấu trúc mã
- `src/mold.js` khuôn 2 mảnh / khuôn tròn, phân tích góc thoát. `src/shell.js` hộp bao. `src/repair.js` vá lưới hở.
- `src/tasks.js` các việc nặng; `src/worker.js` chạy chúng trong Web Worker; nếu không tạo được Worker thì `main.js` chạy trực tiếp.
- `keys.mjs`, `plaster_sim.mjs`, `keys_ui.mjs`: thử chốt định vị; `plaster_sim` mô phỏng đổ thạch cao bằng voxel để kiểm tra hai mảnh không thông nhau qua lỗ chốt và chốt lồi có hình thành.
- `make_huge.mjs`, `huge_ui.mjs`: tạo file hơn 1 triệu mặt và thử tải lên (tự giảm mặt qua voxel, chọn độ chi tiết).
- `threemf.mjs`, `threemf_ui.mjs`, `solid_node.mjs`, `solid_dbg.mjs`: đọc file 3MF (zip + XML, có component, phép biến đổi, đơn vị) và điền đầy vỏ rỗng hở thành khối đặc.
- `snap_node.mjs`, `quality_ui.mjs`, `tri_quality.mjs`, `shell_clean.mjs`, `blow_dbg.mjs`: đo độ bám bề mặt gốc sau khi dựng lại lưới, chụp phôi để so mắt, tìm chỗ phép cắt hộp bao bị bùng nổ số mặt.
- `shapes.mjs`, `shape_ui.mjs`, `shape_compare.mjs`, `plaster_sim2.mjs`, `circle.mjs`: hộp bao 3 kiểu (ôm phôi / hình trụ / hình hộp), gân giữ dây, chế độ không in vỏ, tâm vòng tròn nhỏ nhất; mô phỏng đổ thạch cao kiểm tra không rò giữa các mảnh.
- `dense_node.mjs`, `big_node.mjs`, `divider_dbg*.mjs`, `hole_node.mjs`: phôi nhiều mặt giữ nguyên lưới, vách chia dựng từ lát cắt chính xác (src/slice.js, không phụ thuộc số mặt phôi), vá lỗ nhỏ trực tiếp trên lưới gốc.
- `seq_node.mjs`, `seq_sim.mjs`, `seq_ui.mjs`: chế độ "Đổ lần lượt từng mảnh" (src/seq.js): khay in có rãnh chữ V cho từng mảnh, chốt lồi/hốc nối mảnh k với k+1, phễu rót; mô phỏng đổ thạch cao kiểm tra thể tích, rò và chồng lấn giữa các mảnh.
