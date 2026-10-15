# Thiết lập Supabase

Đây là các bước **bạn** thực hiện — chưa được thử trên dự án Supabase thật trong repo này (migration SQL đã được chạy thử trên PostgreSQL thật qua PGlite).

1. Tạo dự án tại https://supabase.com (gói Free đủ dùng cho một người). Chọn vùng gần Việt Nam (Singapore).
2. **Chạy migration**: SQL Editor → dán lần lượt `supabase/migrations/20260101000000_sync_schema.sql` rồi `20260101000100_ai_quota.sql` (hoặc `supabase link` + `supabase db push`).
3. **Thêm email của bạn** (chữ thường): chạy `supabase/seed.example.sql` sau khi sửa email.
4. **Chặn người lạ đăng ký**: Authentication → Hooks → *Before User Created* → chọn Postgres function `public.hook_before_user_created`. Authentication → Providers → **tắt Email**, chỉ bật Google. (Ngoài hook, RLS + `is_owner()` vẫn chặn truy cập dữ liệu ở máy chủ.)
5. **Google OAuth**: làm theo `SETUP_GOOGLE_OAUTH.md`, dán Client ID/Secret vào Authentication → Providers → Google.
6. Authentication → URL Configuration: *Site URL* = địa chỉ HTTPS nơi bạn host ứng dụng; thêm cùng địa chỉ (và `http://localhost:5173` khi dev) vào *Redirect URLs*.
7. Project Settings → API: sao chép **Project URL** và khóa **anon/publishable** vào `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). **Không** dùng `service_role`.
8. Kiểm tra bảo mật: Advisors → Security (không được có bảng nào tắt RLS). Dùng thử đăng nhập bằng một tài khoản Google **khác** → phải bị từ chối.

## AI (tùy chọn)
```bash
supabase functions deploy ai-proxy
supabase secrets set ANTHROPIC_API_KEY=... AI_MODEL=claude-haiku-5-5 ALLOWED_ORIGIN=https://địa-chỉ-app-của-bạn
```
Hàm kiểm tra JWT + `is_owner()`, giới hạn 20 lượt/ngày (`ai_take_quota`), 16 KB đầu vào, 25 giây timeout. Bật AI trong Cài đặt. Chưa được kiểm thử với dịch vụ thật.

## Host ứng dụng (HTTPS bắt buộc)
`npm run build` → đưa thư mục `dist/` lên hosting tĩnh có HTTPS (Cloudflare Pages, Netlify, Vercel, GitHub Pages…). Đặt biến `VITE_*` lúc build. Thêm header bảo mật (xem SECURITY.md).
