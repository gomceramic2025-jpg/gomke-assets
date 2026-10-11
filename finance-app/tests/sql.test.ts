/**
 * Chạy migration THẬT trên PostgreSQL (PGlite, chạy trong Node) với giả lập schema `auth` của Supabase.
 * Kiểm chứng: RLS, allow-list ở máy chủ, idempotency, phát hiện xung đột, chặn đăng ký người lạ.
 * KHÔNG thay thế việc thử trên dự án Supabase thật (OAuth Google, Auth Hook chưa kiểm thử được ở đây).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';
let pg: PGlite;

const asUser = async <T>(uid: string | null, fn: () => Promise<T>): Promise<T> => {
  await pg.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await fn(); } finally { await pg.exec('reset role;'); }
};
const push = (uid: string, id: string, op: string, base: number, payload = '{"v":1}', col = 'transactions') =>
  asUser(uid, async () => (await pg.query<{ r: Record<string, unknown> }>(
    `select public.push_record($1,$2,$3,$4,false,1,$5,'dev-a') as r`, [col, id, op, base, payload])).rows[0]!.r);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to authenticated, anon, supabase_auth_admin;
    insert into auth.users values ('${OWNER}', 'hy@example.com', now()), ('${STRANGER}', 'stranger@example.com', now());
  `);
  await pg.exec(readFileSync('supabase/migrations/20260101000000_sync_schema.sql', 'utf8'));
  await pg.exec(`insert into public.allowed_owners values ('hy@example.com');`);
});

describe('migration Supabase (PostgreSQL thật qua PGlite)', () => {
  it('bật RLS cho mọi bảng', async () => {
    const r = await pg.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'`);
    expect(r.rows.map((x) => x.relname).sort()).toEqual(["allowed_owners", "devices", "key_envelopes", "sync_ops", "sync_records"]);
    for (const row of r.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it('chủ sở hữu đẩy bản ghi mới thành công, rev=1', async () => {
    const r = await push(OWNER, 'tx-aaaaaaaa', 'op-00000001', 0);
    expect(r).toMatchObject({ status: 'ok', duplicate: false, rev: 1 });
  });

  it('gửi lại cùng op_id không tạo bản ghi mới (idempotent)', async () => {
    const again = await push(OWNER, 'tx-aaaaaaaa', 'op-00000001', 0);
    expect(again).toMatchObject({ status: 'ok', duplicate: true, rev: 1 });
    const n = await pg.query<{ c: number }>(`select count(*)::int c from public.sync_records where record_id='tx-aaaaaaaa'`);
    expect(n.rows[0]!.c).toBe(1);
  });

  it('sửa với base_rev đúng → rev 2; base_rev cũ → xung đột, KHÔNG ghi đè', async () => {
    expect(await push(OWNER, 'tx-aaaaaaaa', 'op-00000002', 1, '{"v":1,"x":"new"}')).toMatchObject({ status: 'ok', rev: 2 });
    const c = await push(OWNER, 'tx-aaaaaaaa', 'op-00000003', 1, '{"v":1,"x":"stale"}');
    expect(c).toMatchObject({ status: 'conflict', rev: 2 });
    const cur = await pg.query<{ payload: string }>(`select payload from public.sync_records where record_id='tx-aaaaaaaa'`);
    expect(cur.rows[0]!.payload).toContain('new');
  });

  it('tạo mới nhưng base_rev ≠ 0 → xung đột; bản ghi tồn tại mà base_rev = 0 → xung đột', async () => {
    expect(await push(OWNER, 'tx-bbbbbbbb', 'op-00000004', 3)).toMatchObject({ status: 'conflict' });
    expect(await push(OWNER, 'tx-aaaaaaaa', 'op-00000005', 0)).toMatchObject({ status: 'conflict' });
  });

  it('seq tăng đơn điệu', async () => {
    await push(OWNER, 'tx-cccccccc', 'op-00000006', 0);
    const r = await asUser(OWNER, () => pg.query<{ seq: string }>(`select seq from public.sync_records order by seq`));
    const seqs = r.rows.map((x) => Number(x.seq));
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('người lạ (không nằm trong allowed_owners) không đọc, không ghi được dù đã đăng nhập', async () => {
    await expect(push(STRANGER, 'tx-dddddddd', 'op-00000007', 0)).rejects.toThrow(/not_owner/);
    const r = await asUser(STRANGER, () => pg.query(`select * from public.sync_records`));
    expect(r.rows).toHaveLength(0);
  });

  it('người dùng ẩn danh (anon) không đọc/ghi được', async () => {
    await expect(asUser(null, () => pg.query(`select * from public.sync_records`))).rejects.toThrow();
    await expect(asUser(null, () => pg.query(`select public.push_record('transactions','tx-eeeeeeee','op-00000008',0,false,1,'x','d')`))).rejects.toThrow();
  });

  it('không ghi trực tiếp vào sync_records, sync_ops, allowed_owners qua API (chỉ qua RPC)', async () => {
    await expect(asUser(OWNER, () => pg.query(`insert into public.sync_records(user_id,collection,record_id,rev,seq,key_version,payload,last_op_id,device_id) values ('${OWNER}','transactions','tx-ffffffff',1,999,1,'x','o','d')`))).rejects.toThrow();
    await expect(asUser(OWNER, () => pg.query(`update public.sync_records set payload='hacked'`))).rejects.toThrow();
    await expect(asUser(OWNER, () => pg.query(`select * from public.sync_ops`))).rejects.toThrow();
    await expect(asUser(OWNER, () => pg.query(`insert into public.allowed_owners values ('x@y.z')`))).rejects.toThrow();
    await expect(asUser(OWNER, () => pg.query(`select * from public.allowed_owners`))).rejects.toThrow();
  });

  it('collection lạ bị từ chối; payload quá lớn bị từ chối', async () => {
    await expect(push(OWNER, 'tx-gggggggg', 'op-00000009', 0, '{}', 'hacker')).rejects.toThrow();
    await expect(push(OWNER, 'tx-gggggggg', 'op-0000000a', 0, 'x'.repeat(262145))).rejects.toThrow();
  });

  it('envelope khóa: chủ sở hữu ghi/đọc được; người lạ thì không', async () => {
    await asUser(OWNER, () => pg.query(`insert into public.key_envelopes(user_id,key_version,kind,envelope) values ('${OWNER}',1,'recovery','{"v":1}')`));
    expect((await asUser(OWNER, () => pg.query(`select * from public.key_envelopes`))).rows).toHaveLength(1);
    expect((await asUser(STRANGER, () => pg.query(`select * from public.key_envelopes`))).rows).toHaveLength(0);
    await expect(asUser(STRANGER, () => pg.query(`insert into public.key_envelopes(user_id,key_version,kind,envelope) values ('${STRANGER}',1,'recovery','{}')`))).rejects.toThrow();
  });

  it('chủ sở hữu A không thấy dữ liệu của người dùng khác dù cùng là chủ (RLS theo user_id)', async () => {
    await pg.exec(`insert into auth.users values ('33333333-3333-3333-3333-333333333333','hy2@example.com',now()); insert into public.allowed_owners values ('hy2@example.com');`);
    const U2 = '33333333-3333-3333-3333-333333333333';
    await push(U2, 'tx-hhhhhhhh', 'op-0000000b', 0);
    const mine = await asUser(OWNER, () => pg.query<{ record_id: string }>(`select record_id from public.sync_records`));
    expect(mine.rows.map((r) => r.record_id)).not.toContain('tx-hhhhhhhh');
  });

  it('hook chặn đăng ký: chỉ email trong allow-list được tạo tài khoản', async () => {
    const ok = await pg.query<{ r: unknown }>(`select public.hook_before_user_created('{"user":{"email":"HY@example.com"}}'::jsonb) as r`);
    expect(ok.rows[0]!.r).toEqual({});
    const no = await pg.query<{ r: { error: { http_code: number } } }>(`select public.hook_before_user_created('{"user":{"email":"evil@x.com"}}'::jsonb) as r`);
    expect(no.rows[0]!.r.error.http_code).toBe(403);
  });

  it('bản ghi đã lưu không chứa bản rõ — chỉ có cột siêu dữ liệu và payload bản mã', async () => {
    const cols = await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name='sync_records' order by 1`);
    const names = cols.rows.map((c) => c.column_name);
    for (const forbidden of ['amount', 'date', 'description', 'note', 'category', 'balance']) expect(names).not.toContain(forbidden);
  });
});
