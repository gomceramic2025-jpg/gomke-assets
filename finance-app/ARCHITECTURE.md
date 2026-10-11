# Kiến trúc

## Tổng quan
React 19 + TypeScript + Vite (PWA tự viết service worker) · Dexie/IndexedDB · Zod · Recharts · Web Crypto · Supabase (Auth + Postgres + Edge Function) tùy chọn.

```
src/
  domain/    Nghiệp vụ thuần (không DB/UI): money, dates, schemas(zod), calc, budget, goals, duplicates
  db/        db.ts (Dexie + migration), repo.ts (điểm ghi duy nhất), seed.ts (mặc định + dữ liệu mẫu)
  crypto/    crypto.ts (AES-256-GCM, HKDF, envelope, khóa khôi phục), keystore.ts (khóa trên thiết bị, đổi khóa)
  sync/      engine.ts (outbox/pull/xung đột), controller.ts (trạng thái UI, retry), supabase.ts (transport thật), types.ts
  io/        importer.ts (CSV/Excel/PDF), exporter.ts, backup.ts, drive.ts
  ai/        rules.ts (phân tích quy tắc), llm.ts (AI tùy chọn qua Edge Function)
  ui/        App, hooks, components, pages (12 màn hình)
supabase/    migrations/*.sql, functions/ai-proxy, config.toml
tests/ e2e/  Vitest, Playwright
```

## Các lớp (theo yêu cầu)
| Lớp | Nơi | Quy tắc |
|---|---|---|
| UI | `ui/` | Không tự tính tiền phức tạp, không truy cập DB tùy tiện: đọc qua `useLedger` (đọc), ghi qua `db/repo` |
| Domain | `domain/` | Hàm thuần có unit test; mọi con số trên dashboard/báo cáo đi qua đây |
| Local repository | `db/repo.ts` | Zod validate → tăng rev → lịch sử (chỉ thêm) → outbox → trong một giao dịch IndexedDB |
| Encryption service | `crypto/` | Chỉ Web Crypto; không tự viết thuật toán |
| Sync service | `sync/` | `SyncTransport` là giao diện; `SupabaseTransport` (thật) và `FakeServer` (test) cùng giao thức |
| Import/export | `io/importer.ts`, `exporter.ts` | Không ghi DB; ghi chỉ qua `commitImport` sau xác nhận |
| AI | `ai/` | Có thể tắt hoàn toàn; không có đường ghi dữ liệu |
| Backup/restore | `io/backup.ts`, `drive.ts` | Kiểm tra toàn vẹn + giao dịch DB nguyên tử |

## Quyết định kỹ thuật
- **Tiền = số nguyên VND** (`Number.isSafeInteger`, trần 9×10¹⁵). Không float.
- **Ngày giao dịch = chuỗi `YYYY-MM-DD` đã kiểm tra lịch thật** (ngày dân sự theo giờ Việt Nam, không gắn giờ → không lệch múi giờ khi đồng bộ). Mốc hệ thống = epoch ms UTC. Hôm nay tính theo `Asia/Ho_Chi_Minh`.
- **Mã hóa**: Web Crypto thay vì thư viện ngoài — chuẩn, đã kiểm chứng, không thêm phụ thuộc. AES-256-GCM, nonce ngẫu nhiên 96-bit/thông điệp, AAD = `collection|id|keyVersion`.
- **Đồng bộ theo bản ghi** (không theo luồng thao tác): đơn giản, dễ kiểm chứng, xung đột phát hiện bằng phiên bản máy chủ (`rev`).
- **Excel**: `exceljs` (không dùng `xlsx` của SheetJS trên npm vì có lỗ hổng đã biết và không được cập nhật). **CSV**: PapaParse. **PDF**: pdfjs-dist, lazy-load.
- **PDF xuất báo cáo**: in của trình duyệt ("Lưu thành PDF") để có tiếng Việt đúng mà không phải nhúng font.
- **Định tuyến** bằng hash (`#/giao-dich`) — chạy được trên mọi hosting tĩnh, không cần rewrite.
- **Phiên bản thư viện** (đã cài, lockfile trong `package-lock.json`): react 19.3, vite 8.3, dexie 4.4, zod 4.6, recharts 3.10, @supabase/supabase-js 2.117, vitest 5.0, playwright 1.64, typescript 6.0, exceljs 4.4, pdfjs-dist 6.4.

## Giới hạn đã biết
- Dữ liệu trong IndexedDB **không mã hóa tại chỗ** (bảo vệ bằng khóa màn hình/ổ đĩa của thiết bị). Mã hóa áp dụng cho dữ liệu rời thiết bị (máy chủ, bản sao lưu).
- Bundle chính ~1,2 MB (355 KB gzip), ExcelJS và PDF.js tách riêng và chỉ tải khi dùng.
- Sao lưu tự động chỉ chạy khi ứng dụng đang mở.
