# Báo cáo kiểm thử

Chạy ngày 2026-10-11 trong môi trường cloud (Node 22, Chromium 1194). Số liệu lấy từ lần chạy thật, không chỉnh sửa.

| Hạng mục | Kết quả |
|---|---|
| `npm run typecheck` | Đạt (0 lỗi) |
| `npm run lint` (src, tests, e2e) | Đạt (0 lỗi, 0 cảnh báo) |
| `npm test` (Vitest) | **138 chạy / 138 đạt / 0 lỗi** (6 tệp) |
| `npm run test:e2e` (Playwright) | **32 chạy / 32 đạt / 0 lỗi** (16 kịch bản × 2 dự án: desktop 1280×800, khung iPhone 390×844 mô phỏng bằng Chromium) |
| `npm run build` | Đạt. Bundle chính 1,2 MB (355 KB gzip); ExcelJS, PDF.js tải riêng |
| `npm run audit` | 2 cảnh báo *moderate* (uuid qua exceljs) — phân tích ở SECURITY.md |

## Vitest theo nhóm
| Tệp | Số test | Nội dung |
|---|---|---|
| `domain.test.ts` | 35 (45 ca kể cả `it.each`) | tiền VND (1.000.000 vs 1.000, số lẻ, tràn), ngày (lịch thật, múi giờ VN), thu/chi, hoàn tiền, điều chỉnh, chuyển nội bộ không thành thu/chi, số dư đầu/cuối kỳ khớp, tài sản ròng, ngân sách, mục tiêu (không tính một đồng hai lần), kịch bản, thiếu dữ liệu, trùng giao dịch, schema |
| `crypto.test.ts` | 13 | AES-GCM, sai khóa, sửa bản mã, AAD, nonce không trùng (20.000), khóa khôi phục, thêm thiết bị, mất khóa, khóa không xuất được |
| `sync.test.ts` | 21 | máy tính→iPhone, iPhone→máy tính, mất mạng, thử lại, gửi lại cùng thao tác, hai thiết bị sửa cùng giao dịch, xóa vs sửa, thùng rác/tombstone, ngoại tuyến lâu ngày, hết phiên/lỗi máy chủ, dữ liệu bị sửa/hoán đổi, đổi khóa, dữ liệu mẫu không đồng bộ, máy chủ không thấy bản rõ |
| `sql.test.ts` | 14 | migration chạy trên PostgreSQL thật (PGlite): RLS mọi bảng, allow-list, idempotent, xung đột, người lạ/anon bị chặn, không ghi trực tiếp, hook chặn đăng ký |
| `import.test.ts` | 21 | CSV UTF-8/`;`/Windows-1258, Excel, PDF có chữ, PDF quét, PDF hỏng, tệp rỗng/quá lớn/sai định dạng, nợ-có, trùng, lỗi khi lưu (hoàn tác), xác nhận mới ghi |
| `data.test.ts` | 24 | thùng rác & lịch sử, ràng buộc, dữ liệu mẫu, sao lưu/khôi phục (thay thế, gộp không nhân đôi, hỏng, mã hóa, thiếu khóa, giữ bản tốt, tự động hằng ngày), Drive (máy chủ giả), AI (redact, ngữ cảnh tối thiểu, lỗi/hủy/timeout/429), phân tích quy tắc |

## Playwright (cả hai dự án)
Chế độ cục bộ không có đăng nhập giả · nhập giao dịch đầu tiên và số liệu tổng quan · kiểm tra biểu mẫu · dữ liệu mẫu · thùng rác & lịch sử · nhập CSV có xác nhận và nghi trùng · tệp sai/rỗng · ngân sách & mục tiêu (chặn phân bổ vượt) · tạo khóa khôi phục (cảnh báo, tick xác nhận, khóa không nằm trong kho trình duyệt) · sao lưu mã hóa → khôi phục, tệp hỏng · Drive chưa cấu hình · trợ lý · xuất CSV/Excel · bố cục không cuộn ngang trên 12 trang (có dữ liệu mẫu) · bàn phím/tên nút · PWA (manifest, icon, service worker, mở lại và ghi dữ liệu khi ngoại tuyến).

Lỗi thật phát hiện nhờ kiểm thử và đã sửa: (1) schema lịch sử làm bản ghi lịch sử bị từ chối khi sao lưu/đồng bộ; (2) cột số tiền có dấu coi số dương không dấu là chi; (3) trang Giao dịch tràn ngang ~700px trên điện thoại do phần tử `sr-only`; (4) kiểm tra độ dài câu hỏi AI bị redact làm sai.

## CHƯA được xác minh (cần thông tin xác thực hoặc thiết bị thật)
- Dự án Supabase thật: đăng nhập Google, Auth Hook, `auth.users` thật, RLS qua PostgREST (đã kiểm bằng PostgreSQL thật nhưng schema `auth` là bản giả lập tối thiểu).
- Đồng bộ giữa máy tính và iPhone thật (logic đã kiểm qua hai cơ sở dữ liệu độc lập + máy chủ giả cùng quy tắc SQL). Quy trình thủ công: `docs/TEST_SYNC_TWO_DEVICES.md`.
- Edge Function `ai-proxy` và API AI thật.
- Google Drive / Google Identity Services thật (kiểm bằng Drive giả).
- Safari/WebKit và iPhone thật (chỉ có Chromium mô phỏng); PWA "Thêm vào Màn hình chính" trên iOS.
- Sao lưu nền khi ứng dụng đóng: không được hỗ trợ (nêu rõ trong giao diện).
- PDF ngân hàng thật: chỉ có bộ đọc heuristic chung, kiểm bằng PDF tự tạo; chưa có adapter riêng cho ngân hàng nào. OCR chưa hỗ trợ.
- Hiệu năng với hàng chục nghìn giao dịch; kiểm toán bảo mật độc lập.

## Việc chủ sở hữu kiểm thử (điền sau)
- [ ] Đồng bộ máy tính → iPhone  - [ ] iPhone → máy tính  - [ ] mất mạng/khôi phục  - [ ] xung đột  - [ ] tài khoản Google lạ bị từ chối  - [ ] sao lưu/khôi phục Drive
