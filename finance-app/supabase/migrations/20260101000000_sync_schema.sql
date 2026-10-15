-- Gốm Kể Finance — lược đồ đồng bộ mã hóa.
-- Máy chủ CHỈ lưu bản mã (payload) + siêu dữ liệu đồng bộ. Không có cột tiền, ngày, nội dung giao dịch dạng rõ.
-- Chạy bằng: supabase db push   (hoặc dán vào SQL Editor)


-- ---------------------------------------------------------------
-- 1) Danh sách chủ sở hữu được phép. Chỉ sửa được bằng SQL Editor / service role.
-- ---------------------------------------------------------------
create table if not exists public.allowed_owners (
  email text primary key check (email = lower(email))
);
alter table public.allowed_owners enable row level security;
-- Không tạo policy nào → anon/authenticated không đọc/ghi được bảng này qua API.
revoke all on public.allowed_owners from anon, authenticated;

-- Kiểm tra QUYỀN Ở MÁY CHỦ: người dùng đã đăng nhập, email đã xác minh, và nằm trong allowed_owners.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    join public.allowed_owners o on o.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

-- Chặn người lạ ĐĂNG KÝ: gắn hàm này vào Auth Hook "Before User Created" (xem docs/SETUP_SUPABASE.md).
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  em text := lower(coalesce(event->'user'->>'email', ''));
begin
  if exists (select 1 from public.allowed_owners where email = em) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Tài khoản này không được phép sử dụng ứng dụng.'));
end;
$$;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------
-- 2) Bản ghi đồng bộ (bản mã)
-- ---------------------------------------------------------------
create sequence if not exists public.sync_seq;

create table if not exists public.sync_records (
  user_id     uuid   not null references auth.users(id) on delete cascade,
  collection  text   not null check (collection in ('settings','accounts','categories','transactions','assets','goals','contributions','budgets','importBatches','history')),
  record_id   text   not null check (length(record_id) between 8 and 64),
  rev         integer not null check (rev >= 1),         -- phiên bản phía máy chủ (tăng 1 mỗi lần chấp nhận thay đổi)
  seq         bigint  not null,                          -- thứ tự toàn cục để các thiết bị kéo thay đổi theo con trỏ
  deleted     boolean not null default false,            -- tombstone (xóa mềm/vĩnh viễn) — chỉ là cờ siêu dữ liệu
  key_version integer not null check (key_version >= 1),
  payload     text    not null check (length(payload) <= 262144),  -- JSON bản mã AES-256-GCM
  last_op_id  text    not null,
  device_id   text    not null check (length(device_id) <= 64),
  updated_at  timestamptz not null default now(),
  primary key (user_id, collection, record_id)
);
create index if not exists sync_records_user_seq on public.sync_records (user_id, seq);

-- Sổ thao tác đã xử lý → gửi lại cùng một thao tác không tạo trùng (idempotent)
create table if not exists public.sync_ops (
  user_id    uuid not null references auth.users(id) on delete cascade,
  op_id      text not null check (length(op_id) between 8 and 64),
  collection text not null,
  record_id  text not null,
  result_rev integer not null,
  result_seq bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, op_id)
);

-- Envelope khóa: khóa dữ liệu đã được BỌC bằng khóa khôi phục (kind='recovery') hoặc bằng khóa cũ (kind='chain').
-- Máy chủ không có khóa khôi phục nên không mở được.
create table if not exists public.key_envelopes (
  user_id     uuid not null references auth.users(id) on delete cascade,
  key_version integer not null check (key_version >= 1),
  kind        text not null check (kind in ('recovery','chain')),
  envelope    jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key_version, kind)
);

create table if not exists public.devices (
  user_id    uuid not null references auth.users(id) on delete cascade,
  device_id  text not null check (length(device_id) <= 64),
  name       text not null check (length(name) <= 80),
  last_seen  timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- ---------------------------------------------------------------
-- 3) RLS: chỉ chủ sở hữu đã xác thực thấy bản ghi của chính mình. Ghi dữ liệu đồng bộ CHỈ qua RPC.
-- ---------------------------------------------------------------
alter table public.sync_records enable row level security;
alter table public.sync_ops enable row level security;
alter table public.key_envelopes enable row level security;
alter table public.devices enable row level security;

drop policy if exists sync_records_select on public.sync_records;
create policy sync_records_select on public.sync_records for select to authenticated
  using (user_id = auth.uid() and public.is_owner());

drop policy if exists key_envelopes_all on public.key_envelopes;
create policy key_envelopes_all on public.key_envelopes for all to authenticated
  using (user_id = auth.uid() and public.is_owner())
  with check (user_id = auth.uid() and public.is_owner());

drop policy if exists devices_all on public.devices;
create policy devices_all on public.devices for all to authenticated
  using (user_id = auth.uid() and public.is_owner())
  with check (user_id = auth.uid() and public.is_owner());

-- sync_ops: không có policy → không truy cập trực tiếp qua API (chỉ hàm security definer)
revoke all on public.sync_records, public.sync_ops from anon, authenticated;
grant select on public.sync_records to authenticated;
revoke all on public.key_envelopes, public.devices from anon;
grant select, insert, update, delete on public.key_envelopes, public.devices to authenticated;

-- ---------------------------------------------------------------
-- 4) RPC đẩy thay đổi (khóa theo người dùng để seq tăng đúng thứ tự commit)
--    Trả về: { status: 'ok'|'conflict', duplicate: bool, rev, seq, record: {...bản ghi hiện tại...} }
-- ---------------------------------------------------------------
create or replace function public.push_record(
  p_collection text, p_record_id text, p_op_id text, p_base_rev integer,
  p_deleted boolean, p_key_version integer, p_payload text, p_device_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cur public.sync_records;
  op  public.sync_ops;
  new_rev integer;
  new_seq bigint;
begin
  if uid is null or not public.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  -- 1) Thao tác này đã được xử lý trước đó → trả kết quả cũ (gửi lại do mất mạng)
  select * into op from public.sync_ops where user_id = uid and op_id = p_op_id;
  if found then
    select * into cur from public.sync_records where user_id = uid and collection = p_collection and record_id = p_record_id;
    return jsonb_build_object('status', 'ok', 'duplicate', true, 'rev', op.result_rev, 'seq', op.result_seq,
      'record', case when cur.record_id is null then null else to_jsonb(cur) - 'user_id' end);
  end if;

  select * into cur from public.sync_records where user_id = uid and collection = p_collection and record_id = p_record_id for update;

  -- 2) Kiểm tra phiên bản: bản ghi trên máy chủ đã thay đổi so với bản mà thiết bị dựa vào → xung đột (KHÔNG ghi đè)
  if found and cur.rev <> p_base_rev then
    return jsonb_build_object('status', 'conflict', 'duplicate', false, 'rev', cur.rev, 'seq', cur.seq, 'record', to_jsonb(cur) - 'user_id');
  end if;
  if not found and p_base_rev <> 0 then
    return jsonb_build_object('status', 'conflict', 'duplicate', false, 'rev', 0, 'seq', 0, 'record', null);
  end if;

  new_rev := coalesce(cur.rev, 0) + 1;
  new_seq := nextval('public.sync_seq');
  insert into public.sync_records as r (user_id, collection, record_id, rev, seq, deleted, key_version, payload, last_op_id, device_id, updated_at)
  values (uid, p_collection, p_record_id, new_rev, new_seq, p_deleted, p_key_version, p_payload, p_op_id, p_device_id, now())
  on conflict (user_id, collection, record_id) do update
    set rev = excluded.rev, seq = excluded.seq, deleted = excluded.deleted, key_version = excluded.key_version,
        payload = excluded.payload, last_op_id = excluded.last_op_id, device_id = excluded.device_id, updated_at = now();
  insert into public.sync_ops (user_id, op_id, collection, record_id, result_rev, result_seq)
  values (uid, p_op_id, p_collection, p_record_id, new_rev, new_seq);

  select * into cur from public.sync_records where user_id = uid and collection = p_collection and record_id = p_record_id;
  return jsonb_build_object('status', 'ok', 'duplicate', false, 'rev', new_rev, 'seq', new_seq, 'record', to_jsonb(cur) - 'user_id');
end;
$$;
revoke all on function public.push_record(text, text, text, integer, boolean, integer, text, text) from public, anon;
grant execute on function public.push_record(text, text, text, integer, boolean, integer, text, text) to authenticated;
