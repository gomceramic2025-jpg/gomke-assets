-- Chạy trong SQL Editor của Supabase SAU KHI chạy các migration. Thay bằng email Google của CHÍNH BẠN.
insert into public.allowed_owners (email) values ('ten-ban@gmail.com') on conflict do nothing;
