# Gốm Kể · Tài chính cá nhân

Phần mềm quản lý **tài chính cá nhân** (không phải kế toán doanh nghiệp) cho một chủ sở hữu. Thiết kế **local-first**: dữ liệu nằm trong trình duyệt của bạn (IndexedDB), chạy được hoàn toàn offline, đồng bộ máy tính ↔ iPhone **mã hóa phía thiết bị** là tùy chọn.

> Trạng thái thật (không tô vẽ): chế độ cục bộ đã chạy và kiểm thử đầy đủ. Đồng bộ, đăng nhập Google, Google Drive và AI **đã được lập trình và kiểm thử với máy chủ giả lập / PostgreSQL thật qua PGlite**, nhưng **chưa được thử với dự án Supabase / Google thật** vì cần thông tin xác thực của bạn. Xem `TEST_REPORT.md` và mục "Việc bạn phải tự làm" bên dưới.

## Chạy nhanh (không cần tài khoản nào)

```bash
cd finance-app
npm install
npm run dev          # http://localhost:5173
```

Mở ứng dụng → **Cài đặt → Nạp dữ liệu mẫu để thử** (có nhãn "Mẫu", xóa riêng được). Hoặc vào **Giao dịch → Thêm giao dịch** để nhập giao dịch thật đầu tiên.

| Lệnh | Việc |
|---|---|
| `npm run dev` | server phát triển |
| `npm run build` | kiểm tra kiểu + build production (`dist/`) |
| `npm run preview` | chạy bản build ở http://localhost:4173 |
| `npm run typecheck` | kiểm tra kiểu TypeScript |
| `npm run lint` | ESLint |
| `npm test` | unit + integration (Vitest) |
| `npm run test:e2e` | end-to-end (Playwright, Chromium; desktop + khung iPhone mô phỏng) |
| `npm run audit` | `npm audit` cho phụ thuộc chạy thật |

E2E dùng Chromium có sẵn ở `/opt/pw-browsers/chromium` (đổi bằng `PW_CHROMIUM_PATH`). Nếu máy bạn chưa có: `npx playwright install chromium`.

## Tính năng
Tổng quan · Giao dịch (thu/chi/chuyển tiền/điều chỉnh, thùng rác, lịch sử) · Nhập sao kê CSV/Excel/PDF có bước xác nhận · Ngân sách · Mục tiêu 36 tháng + 3 kịch bản · Tài sản & tài sản ròng · Báo cáo tháng/năm/dòng tiền (CSV, Excel, in PDF) · Đồng bộ mã hóa · Sao lưu/khôi phục (+Google Drive tùy chọn) · Cài đặt · Phân tích quy tắc + AI tùy chọn.

## Cấu hình dịch vụ thật (tùy chọn)
Sao chép `.env.example` → `.env.local`. Không điền gì = chế độ cục bộ.

| Biến | Dùng cho |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | đồng bộ + đăng nhập Google (khóa **anon/publishable**, an toàn để ở frontend nhờ RLS) |
| `VITE_OWNER_EMAIL` | chỉ để báo sớm ở giao diện; quyền thật ở bảng `allowed_owners` |
| `VITE_REQUIRE_LOGIN` | `true` = bắt buộc đăng nhập trước khi mở app |
| `VITE_GOOGLE_CLIENT_ID` | sao lưu Google Drive |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | **chỉ** đặt bằng `supabase secrets set` cho Edge Function `ai-proxy` |

Hướng dẫn từng bước: [`docs/SETUP_SUPABASE.md`](docs/SETUP_SUPABASE.md), [`docs/SETUP_GOOGLE_OAUTH.md`](docs/SETUP_GOOGLE_OAUTH.md), [`docs/IPHONE_PWA.md`](docs/IPHONE_PWA.md), [`docs/TEST_SYNC_TWO_DEVICES.md`](docs/TEST_SYNC_TWO_DEVICES.md), [`docs/TROUBLESHOOTING_SYNC.md`](docs/TROUBLESHOOTING_SYNC.md), [`docs/COSTS.md`](docs/COSTS.md).

## Việc bạn phải tự làm
1. Tạo dự án Supabase, chạy migration, thêm email của bạn vào `allowed_owners`, bật Auth Hook chặn người lạ.
2. Tạo Google OAuth client, dán vào Supabase Auth.
3. Điền `.env.local`, build và **host qua HTTPS** (PWA/Web Crypto trên iPhone cần HTTPS).
4. Tạo khóa khôi phục và **cất ngoại tuyến**. Mất khóa + mất hết thiết bị = mất dữ liệu đã mã hóa.
5. Kiểm thử đồng bộ hai thiết bị thật theo `docs/TEST_SYNC_TWO_DEVICES.md`.
6. (Tùy chọn) Google Drive, AI.

## Tài liệu
[`ARCHITECTURE.md`](ARCHITECTURE.md) · [`SECURITY.md`](SECURITY.md) · [`DATA_MODEL.md`](DATA_MODEL.md) · [`SYNC_DESIGN.md`](SYNC_DESIGN.md) · [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) · [`TEST_REPORT.md`](TEST_REPORT.md)
