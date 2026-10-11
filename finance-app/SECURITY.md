# Bảo mật

> Không có kiểm toán bảo mật độc lập nào được thực hiện. Mã hóa không đồng nghĩa phần mềm "hoàn toàn an toàn". Mô tả dưới đây là thiết kế và những gì đã được kiểm thử tự động.

## Dữ liệu nằm ở đâu
| Dữ liệu | Trên thiết bị | Trên Supabase | Trên Google Drive |
|---|---|---|---|
| Giao dịch, tài khoản, mục tiêu, tài sản… | IndexedDB, **không mã hóa tại chỗ** | Chỉ **bản mã** AES-256-GCM | Chỉ bản sao lưu **đã mã hóa** (mặc định) |
| Khóa dữ liệu (DEK) | `CryptoKey` **không xuất được** trong IndexedDB | Không bao giờ | Không bao giờ |
| Khóa khôi phục | **Không lưu** (chỉ hiện một lần) | Không bao giờ | Không bao giờ |
| Envelope (DEK bọc bằng khóa khôi phục) | Có | Có (không mở được nếu thiếu khóa khôi phục) | Trong tệp sao lưu |
| Email Google, ID người dùng, token phiên | Phiên Supabase (localStorage) | Supabase Auth | — |
| Siêu dữ liệu đồng bộ **dạng rõ** | — | tên bảng (collection), ID bản ghi, số phiên bản, thứ tự, cờ xóa, phiên bản khóa, ID thiết bị, kích thước và thời điểm ghi | tên tệp, thời điểm, hash |
| Số tiền, ngày, nội dung, danh mục, tên tài khoản, ghi chú | Có | **Không** (nằm trong bản mã) | **Không** (trong bản mã) |

Lưu ý: ID của dữ liệu mặc định (ví dụ `acc-bank`, `cat-exp-living`) là siêu dữ liệu dạng rõ; ID giao dịch là chuỗi ngẫu nhiên.

## Mã hóa và khóa
- AES-256-GCM qua Web Crypto; nonce 96-bit ngẫu nhiên mỗi thông điệp, API không nhận nonce từ ngoài (test 20.000 lần không trùng). Giới hạn khuyến nghị 2³² thông điệp/khóa; dùng thực tế thấp hơn nhiều bậc; có "Đổi khóa".
- AAD = `collection|id|keyVersion`: không thể hoán đổi bản mã giữa các bản ghi hoặc phiên bản khóa (test).
- DEK ngẫu nhiên 256-bit sinh trên thiết bị. Khóa khôi phục ngẫu nhiên 256-bit hiển thị Crockford base32 + mã kiểm tra (phát hiện gõ sai). KEK = HKDF-SHA256(khóa khôi phục, salt ngẫu nhiên). Vì khóa khôi phục đã ngẫu nhiên đủ entropy nên không cần hàm làm chậm (Argon2/PBKDF2) — **không dùng cụm mật khẩu do người dùng tự nghĩ**.
- Google OAuth chỉ xác thực danh tính. Token/mật khẩu Google **không** dùng làm khóa.
- **Đổi khóa**: DEK mới (v+1) + khóa khôi phục mới; envelope "chain" (DEK mới mã hóa bằng DEK cũ) cho thiết bị đang có khóa cũ tự theo kịp; "Hoàn tất đổi khóa" xóa envelope cũ để khóa khôi phục cũ hết tác dụng với dữ liệu mới. Test: `tests/sync.test.ts`.
- **Mất khóa khôi phục + mất hết thiết bị = không khôi phục được dữ liệu mã hóa** (không có cửa hậu). Giao diện cảnh báo và bắt tick xác nhận đã lưu.

## Điều đã được kiểm thử tự động
Bản mã không chứa bản rõ · sai khóa thất bại an toàn · phát hiện sửa/hoán đổi bản mã · thêm thiết bị bằng khóa khôi phục · sai/mất khóa khôi phục · khóa khôi phục không nằm trong bất kỳ kho lưu trữ trình duyệt nào (e2e) · nội dung sao lưu không lộ bản rõ · RLS và allow-list ở PostgreSQL thật (PGlite) · người lạ/anon không đọc-ghi được · không ghi trực tiếp vào bảng đồng bộ.

## Điều CHƯA được xác minh
- Đăng nhập Google, Auth Hook "Before User Created", `auth.users` thật của Supabase (test dùng schema `auth` giả lập tối thiểu).
- Edge Function `ai-proxy` chạy trên Deno/Supabase thật và API nhà cung cấp AI.
- OAuth/GIS và Drive API thật (test dùng máy chủ Drive giả).
- Safari/iPhone thật (e2e dùng Chromium mô phỏng kích thước + UA iPhone, không phải WebKit).
- Kiểm thử xâm nhập, kiểm toán mã hóa độc lập.

## Phân quyền
- Một chủ sở hữu. Quyền kiểm tra ở **máy chủ**: `is_owner()` (người dùng đã xác minh email và email nằm trong `allowed_owners`) áp dụng trong RLS và trong RPC `push_record`. `VITE_OWNER_EMAIL` chỉ để giao diện báo sớm.
- Auth Hook `hook_before_user_created` từ chối đăng ký của email lạ. Tắt đăng ký bằng email/mật khẩu trong Dashboard.
- Ghi vào `sync_records` chỉ qua RPC (idempotent theo `op_id`, kiểm tra phiên bản). `allowed_owners`, `sync_ops`, `ai_usage` không truy cập được qua API.

## Bí mật
- Frontend chỉ có URL + khóa **anon**. **Không** đặt service-role key, khóa AI, secret OAuth trong frontend/repo. `.env*` đã nằm trong `.gitignore`; `.env.example` không có giá trị thật.
- API key AI chỉ ở `supabase secrets` cho Edge Function.
- Không ghi token/khóa/nội dung giao dịch vào console. Nhật ký lô nhập không chứa nội dung giao dịch. Không có analytics/telemetry.

## Web
- Dữ liệu người dùng chỉ được render qua React (thoát HTML tự động), không dùng `dangerouslySetInnerHTML`/`innerHTML`.
- CSP trong `index.html` giới hạn nguồn script/kết nối (Supabase, Google). Khi host, nên thêm header: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` (CSP qua `<meta>` không áp dụng `frame-ancestors`).
- Xuất CSV/Excel thêm `'` trước ô bắt đầu bằng `= + - @` (chống formula injection) — có test.
- Tệp nhập: giới hạn 10 MB/20.000 dòng, kiểm tra magic bytes, từ chối `.xls` cũ và tệp nhị phân đội lốt.

## Phụ thuộc
`npm run audit` (chỉ phụ thuộc chạy thật). Hiện còn 2 cảnh báo mức *moderate*: `uuid` < 11.1.1 (GHSA-w5hq-g745-h8pq: thiếu kiểm tra biên khi truyền `buf` cho uuid v3/v5/v6) kéo theo qua `exceljs`. ExcelJS chỉ dùng `uuid.v4()` không truyền `buf` nên không bị ảnh hưởng; `npm audit fix --force` sẽ hạ `exceljs` xuống 3.4.0 (phá vỡ) nên **không áp dụng**. Theo dõi bản exceljs mới.

## Bảo vệ thiết bị và khóa khôi phục (khuyến nghị)
1. Bật khóa màn hình và mã hóa ổ đĩa (FileVault/BitLocker/iPhone passcode) — dữ liệu cục bộ chỉ được bảo vệ bằng chúng.
2. Cất khóa khôi phục **ngoại tuyến**, ở ít nhất hai nơi, tách khỏi thiết bị (giấy trong két, trình quản lý mật khẩu).
3. Không chụp màn hình/gửi khóa khôi phục qua chat/email.
4. Dùng tệp sao lưu `.gomke-fin` đã mã hóa; không chia sẻ cho ai.
5. Nếu nghi lộ khóa: **Đổi khóa** rồi **Hoàn tất đổi khóa**.
