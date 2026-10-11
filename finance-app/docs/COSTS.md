# Dự toán chi phí (tham khảo — kiểm tra lại bảng giá hiện hành của từng nhà cung cấp)

Cấu hình thực tế của dự án: 1 người dùng, vài nghìn bản ghi mã hóa (vài MB), 2 thiết bị.

| Hạng mục | Cấu hình | Chi phí dự kiến |
|---|---|---|
| Ứng dụng (hosting tĩnh) | Cloudflare Pages / Netlify / Vercel / GitHub Pages | 0 ₫ (gói miễn phí) |
| Supabase | Gói Free (500 MB DB, Auth, Edge Functions) | 0 ₫. Lưu ý: dự án Free có thể bị **tạm dừng sau thời gian không hoạt động** — mở app/đồng bộ định kỳ hoặc dùng gói Pro (~25 USD/tháng) nếu cần ổn định |
| Google OAuth / Drive appdata | Dùng cá nhân | 0 ₫ |
| Tên miền (tùy chọn) | .com / .vn | ~10–20 USD/năm |
| AI (tùy chọn) | Vài câu hỏi/tuần, ≤ 12 KB mỗi lần, giới hạn 20 lượt/ngày | Rất nhỏ (thường dưới vài USD/tháng, tùy mô hình và giá hiện hành). Giới hạn cứng nằm ở `ai_take_quota` |
| **Tổng cho dùng cá nhân cơ bản** | | **≈ 0 ₫/tháng** (+ tên miền nếu muốn) |
