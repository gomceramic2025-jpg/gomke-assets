-- Giới hạn chi phí AI ở máy chủ: tối đa N lần gọi / ngày / người dùng. Edge Function ai-proxy gọi hàm này TRƯỚC khi gọi nhà cung cấp AI.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  calls   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;  -- không policy → chỉ hàm security definer truy cập

create or replace function public.ai_take_quota(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  used integer;
begin
  if uid is null or not public.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  insert into public.ai_usage as u (user_id, day, calls) values (uid, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set calls = u.calls + 1
  returning calls into used;
  if used > greatest(1, least(p_limit, 200)) then
    update public.ai_usage set calls = calls - 1 where user_id = uid and day = (now() at time zone 'utc')::date;
    return jsonb_build_object('allowed', false, 'used', used - 1, 'limit', p_limit);
  end if;
  return jsonb_build_object('allowed', true, 'used', used, 'limit', p_limit);
end;
$$;
revoke all on function public.ai_take_quota(integer) from public, anon;
grant execute on function public.ai_take_quota(integer) to authenticated;
