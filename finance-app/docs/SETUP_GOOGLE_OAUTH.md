# Thiết lập Google OAuth

## A. Đăng nhập (qua Supabase)
1. https://console.cloud.google.com → tạo project → *APIs & Services → OAuth consent screen*: loại *External*, thêm email của bạn vào *Test users* (để ở chế độ Testing là đủ cho một người).
2. *Credentials → Create credentials → OAuth client ID → Web application*.
   - *Authorized redirect URIs*: `https://<project-ref>.supabase.co/auth/v1/callback` (lấy đúng chuỗi trong Supabase → Authentication → Providers → Google).
3. Dán **Client ID** và **Client secret** vào Supabase (Providers → Google). Secret chỉ ở Supabase, không vào repo/`.env`.
4. Scope mặc định (`openid email profile`) là đủ.

## B. Sao lưu Google Drive (tùy chọn)
1. Cùng project, bật *Google Drive API*.
2. Tạo thêm một OAuth client ID loại *Web application*; *Authorized JavaScript origins*: địa chỉ ứng dụng của bạn (và `http://localhost:5173`).
3. Điền **Client ID** vào `VITE_GOOGLE_CLIENT_ID` (không cần secret).
4. Trong consent screen, thêm scope `https://www.googleapis.com/auth/drive.appdata` (scope tối thiểu: thư mục ẩn riêng của ứng dụng).
Ứng dụng chỉ xin quyền khi bạn bấm "Kết nối Google Drive"; token chỉ giữ trong bộ nhớ.
