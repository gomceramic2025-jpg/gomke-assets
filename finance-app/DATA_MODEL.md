# Mô hình dữ liệu (schema version 1)

Nguồn sự thật là Zod trong `src/domain/schemas.ts`; IndexedDB được khai báo trong `src/db/db.ts` (`version(1)`). Khi đổi cấu trúc: thêm `version(n+1).stores().upgrade()`, **không sửa version cũ**; tăng `SCHEMA_VERSION` và `BACKUP_VERSION` nếu định dạng tệp sao lưu đổi.

## Trường chung của mọi bản ghi đồng bộ
`id` · `rev` (tăng mỗi lần sửa cục bộ) · `createdAt`/`updatedAt` (epoch ms) · `deletedAt` (xóa mềm/thùng rác) · `purged` (xóa vĩnh viễn: chỉ còn tombstone `{id, rev, purged}`) · `isSample`.

## Bảng đồng bộ được
| Bảng | Nội dung chính |
|---|---|
| `settings` (1 bản ghi `settings-main`) | tên, chi phí cơ sở 5.000.000, số tháng dự phòng 3, kế hoạch 36 tháng, nghĩa vụ khai báo (null = chưa khai báo), AI bật/tắt, sao lưu tự động |
| `accounts` | tên, loại (tiền mặt/ngân hàng/ví/tiết kiệm), số dư đầu + ngày, 4 số cuối (không lưu số đầy đủ), lưu trữ |
| `categories` | tên, loại thu/chi, `systemKey` (mặc định có ID cố định để hai thiết bị khởi tạo không nhân đôi) |
| `transactions` | `type` income/expense/transfer/adjustment · `amount` số nguyên (adjustment có dấu) · `refund` · `date` · `recordedAt` · `categoryId` · `accountId`/`toAccountId` · nội dung, đối tác, ghi chú, tags · `source` manual/excel/csv/pdf/sample · `importBatchId` · `bankRef` · `status` confirmed/pending |
| `assets` | tên, loại, thanh khoản (cao/bán được/khó), ngày định giá, giá trị, giá mua, ghi chú |
| `goals` | tên, số tiền cần (0 = chưa đặt), hạn (tháng), ưu tiên, đóng góp dự kiến/tháng, trạng thái |
| `contributions` | phân bổ tiền **thực tế** vào mục tiêu (`amount` có dấu), `sourceTxId` (mỗi giao dịch chỉ gán một lần) |
| `budgets` | hạn mức/tháng theo danh mục, hiệu lực từ tháng nào, nguồn user/ai-approved |
| `importBatches` | tên tệp, loại, số dòng, hash tệp, nhật ký (không chứa nội dung giao dịch) |
| `history` | nhật ký chỉ-thêm: thao tác, bản ghi, thay đổi trước/sau |

Bảng chỉ cục bộ: `outbox`, `syncMeta`, `conflicts`, `keyring` (CryptoKey không xuất được), `envelopes`, `backups`, `kv`.

## Trạng thái đồng bộ của giao dịch
Không lưu cứng; suy ra khi hiển thị: có trong `outbox` → "Chờ đồng bộ"; có trong `conflicts` → "Xung đột"; còn lại (đã đăng nhập) → "Đã đồng bộ"; chưa cấu hình → "Chỉ trên máy này"; dữ liệu mẫu → không đồng bộ.

## Công thức (src/domain/calc.ts)
- Tác động số dư: income +amount; expense −amount (hoàn tiền +amount); transfer −amount ở nguồn, +amount ở đích; adjustment +amount có dấu. Chỉ giao dịch `confirmed`, chưa xóa.
- Thu/chi kỳ: chuyển tiền và điều chỉnh **không** vào thu/chi; hoàn tiền trừ vào chi phí.
- Số dư đầu kỳ + tài khoản mới mở + thu + hoàn tiền − chi ± chuyển nội bộ ± điều chỉnh = số dư cuối kỳ (có test).
- Tài sản ròng = số dư sổ + tài sản nhập tay − nghĩa vụ đã khai báo. `liabilitiesDeclared=false` luôn được hiển thị là cảnh báo. Tiền chi tiêu được (`spendable`) chỉ gồm tiền sổ + tài sản thanh khoản cao.
- Khả năng tiết kiệm: tối đa 6 tháng đã kết thúc, cần ≥ 3 tháng; thận trọng/cơ sở/tích cực = phân vị 25%/50%/75% của (thu−chi), không âm.
