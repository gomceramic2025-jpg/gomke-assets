import { describe, it, expect, beforeEach } from 'vitest';
import { FakeServer } from './helpers/fakeServer';
import { makeDevice, type Device } from './helpers/device';
import * as repo from '../src/db/repo';
import { ensureDefaults, loadSampleData } from '../src/db/seed';
import { createKeys, unlockWithRecoveryKey, rotateKeys, pruneOldEnvelopes, hasKeys } from '../src/crypto/keystore';
import { retryDelaySec } from '../src/sync/engine';
import { fromB64, toB64 } from '../src/crypto/crypto';

let server: FakeServer;
let A: Device, B: Device;
let recovery = '';

const addTx = (d: Device, extra: Record<string, unknown> = {}) => d.on(() => repo.create('transactions', {
  type: 'expense', amount: 150_000, date: '2026-03-05', accountId: 'acc-bank', categoryId: 'cat-exp-living', description: 'Bí mật: tiền thuốc cho mẹ', ...extra,
}));
const sync = (d: Device) => d.on(() => d.engine.syncOnce());
const getTx = (d: Device, id: string) => d.on(() => d.db.transactions.get(id));

beforeEach(async () => {
  server = new FakeServer();
  A = makeDevice('A', server); B = makeDevice('B', server);
  await A.on(async () => {
    await ensureDefaults();
    const k = await createKeys();
    recovery = k.recoveryKey;
    await server.transport('A').putEnvelopes(k.envelopes);
  });
  await sync(A);
  await B.on(async () => {
    await unlockWithRecoveryKey(recovery, await server.transport('B').getEnvelopes());
    await ensureDefaults();
  });
});

describe('đồng bộ mã hóa giữa hai thiết bị', () => {
  it('máy chủ chỉ thấy bản mã — không có nội dung tài chính dạng rõ', async () => {
    await addTx(A);
    const r = await sync(A);
    expect(r.status).toBe('synced');
    // Siêu dữ liệu dạng rõ trên máy chủ: collection, recordId, rev, seq, deleted, keyVersion, deviceId, kích thước payload.
    // Nội dung (payload) và envelope không được chứa bất kỳ giá trị tài chính nào.
    const content = JSON.stringify([...server.rows.values()].map((r) => r.payload)) + JSON.stringify(server.envelopes);
    for (const secret of ['Bí mật', 'tiền thuốc', '150000', 'acc-bank', 'cat-exp-living', 'Sinh hoạt', 'amount', 'description', 'Tiền mặt', 'Quỹ dự phòng', '15000000']) expect(content).not.toContain(secret);
    const keys = new Set([...server.rows.values()].flatMap((r) => Object.keys(r)));
    expect([...keys].sort()).toEqual(['collection', 'deleted', 'deviceId', 'keyVersion', 'lastOp', 'payload', 'recordId', 'rev', 'seq']);
    expect(server.pushLog.length).toBeGreaterThan(0);
    for (const op of server.pushLog) expect(JSON.parse(op.payload)).toHaveProperty('c');
  });

  it('máy tính → iPhone: giao dịch tạo ở A xuất hiện ở B', async () => {
    const tx = await addTx(A);
    await sync(A);
    const r = await sync(B);
    expect(r.status).toBe('synced');
    expect((await getTx(B, tx.id))?.description).toBe('Bí mật: tiền thuốc cho mẹ');
  });

  it('iPhone → máy tính', async () => {
    const tx = await addTx(B, { amount: 99_000 });
    await sync(B); await sync(A);
    expect((await getTx(A, tx.id))?.amount).toBe(99_000);
  });

  it('hai thiết bị cùng khởi tạo dữ liệu mặc định không sinh xung đột hay bản trùng', async () => {
    await sync(B); await sync(A);
    expect(await A.db.conflicts.count()).toBe(0);
    expect(await B.db.conflicts.count()).toBe(0);
    expect(await A.db.categories.count()).toBe(11);
    expect(await B.db.categories.count()).toBe(11);
  });

  it('mất Internet: giữ trong hàng đợi, báo offline (không báo đã đồng bộ); có mạng lại thì tự đẩy', async () => {
    server.offline = true;
    const tx = await addTx(A);
    const r = await sync(A);
    expect(r.status).toBe('offline');
    expect(await A.db.outbox.count()).toBeGreaterThan(0);
    server.offline = false;
    expect((await sync(A)).status).toBe('synced');
    expect(await A.db.outbox.count()).toBe(0);
    await sync(B);
    expect(await getTx(B, tx.id)).toBeTruthy();
  });

  it('gửi cùng một thay đổi nhiều lần / mất phản hồi: không tạo trùng (idempotent)', async () => {
    const tx = await addTx(A);
    server.dropResponseOnce = true;
    expect((await sync(A)).status).not.toBe('synced');
    const r = await sync(A); // gửi lại cùng opId
    expect(r.status).toBe('synced');
    const opIds = server.pushLog.map((o) => o.opId);
    expect(opIds.length).toBeGreaterThan(new Set(opIds).size); // có thao tác bị gửi lại
    expect(server.ops.size).toBe(new Set(opIds).size); // nhưng mỗi thao tác chỉ được áp dụng một lần
    const row = server.rows.get(`transactions:${tx.id}`)!;
    expect(row.rev).toBe(1);
    await sync(B);
    expect(await B.db.transactions.where('id').equals(tx.id).count()).toBe(1);
  });

  it('hai thiết bị sửa cùng giao dịch → XUNG ĐỘT, không ghi đè; người dùng chọn bản đúng', async () => {
    const tx = await addTx(A);
    await sync(A); await sync(B);
    await A.on(() => repo.update('transactions', tx.id, { amount: 200_000 }));
    await B.on(() => repo.update('transactions', tx.id, { amount: 300_000 }));
    expect((await sync(A)).status).toBe('synced');
    const rb = await sync(B);
    expect(rb.status).toBe('conflict');
    const c = (await B.db.conflicts.toArray())[0]!;
    expect((c.local as { amount: number }).amount).toBe(300_000);
    expect((c.remote as { amount: number }).amount).toBe(200_000);
    // bản trên thiết bị B chưa bị ghi đè
    expect((await getTx(B, tx.id))!.amount).toBe(300_000);
    // chọn bản của thiết bị khác
    await B.on(() => B.engine.resolveConflict(c.key, 'remote'));
    expect((await getTx(B, tx.id))!.amount).toBe(200_000);
    expect((await sync(B)).status).toBe('synced');
    expect(await B.db.conflicts.count()).toBe(0);
  });

  it('xung đột: giữ bản cục bộ thì đẩy lên và thiết bị kia nhận được', async () => {
    const tx = await addTx(A);
    await sync(A); await sync(B);
    await A.on(() => repo.update('transactions', tx.id, { amount: 200_000 }));
    await B.on(() => repo.update('transactions', tx.id, { amount: 300_000 }));
    await sync(A); await sync(B);
    const c = (await B.db.conflicts.toArray())[0]!;
    await B.on(() => B.engine.resolveConflict(c.key, 'local'));
    expect((await sync(B)).status).toBe('synced');
    await sync(A);
    expect((await getTx(A, tx.id))!.amount).toBe(300_000);
  });

  it('xung đột: giữ cả hai tạo thêm một giao dịch mới có ghi chú, không mất dữ liệu', async () => {
    const tx = await addTx(A);
    await sync(A); await sync(B);
    await A.on(() => repo.update('transactions', tx.id, { amount: 200_000 }));
    await B.on(() => repo.update('transactions', tx.id, { amount: 300_000 }));
    await sync(A); await sync(B);
    const c = (await B.db.conflicts.toArray())[0]!;
    await B.on(() => B.engine.resolveConflict(c.key, 'both'));
    const all = await B.db.transactions.toArray();
    expect(all.filter((t) => t.description.startsWith('Bí mật'))).toHaveLength(2);
    expect(all.map((t) => t.amount).sort()).toEqual([200_000, 300_000]);
  });

  it('xóa ở máy này, sửa ở máy kia → xung đột (giao dịch đã xóa không tự sống lại)', async () => {
    const tx = await addTx(A);
    await sync(A); await sync(B);
    await A.on(() => repo.softDelete('transactions', tx.id));
    await B.on(() => repo.update('transactions', tx.id, { note: 'sửa offline' }));
    await sync(A);
    expect((await sync(B)).status).toBe('conflict');
    expect((await getTx(A, tx.id))!.deletedAt).toBeTruthy();
    const c = (await B.db.conflicts.toArray())[0]!;
    expect((c.remote as { deletedAt: number | null }).deletedAt).toBeTruthy();
  });

  it('xóa mềm đồng bộ sang thiết bị kia (vào thùng rác); khôi phục cũng đồng bộ', async () => {
    const tx = await addTx(A);
    await sync(A); await sync(B);
    await A.on(() => repo.softDelete('transactions', tx.id));
    await sync(A); await sync(B);
    expect((await getTx(B, tx.id))!.deletedAt).toBeTruthy();
    await A.on(() => repo.restore('transactions', tx.id));
    await sync(A); await sync(B);
    expect((await getTx(B, tx.id))!.deletedAt).toBeNull();
  });

  it('xóa vĩnh viễn để lại tombstone và đồng bộ; nội dung không còn ở thiết bị kia', async () => {
    const tx = await addTx(A);
    await sync(A); await sync(B);
    await A.on(async () => { await repo.softDelete('transactions', tx.id); await repo.purge('transactions', tx.id); });
    await sync(A); await sync(B);
    const b = (await getTx(B, tx.id))!;
    expect(b.purged).toBe(true);
    expect(JSON.stringify(b)).not.toContain('Bí mật');
    expect(server.rows.get(`transactions:${tx.id}`)!.deleted).toBe(true);
  });

  it('thiết bị ngoại tuyến lâu ngày bắt kịp nhiều thay đổi (thêm/sửa/xóa) mà không mất dữ liệu', async () => {
    const keep = await addTx(A); const del = await addTx(A, { amount: 1000 });
    await sync(A); await sync(B);
    server.offline = true; // B ngoại tuyến
    await sync(B);
    server.offline = false;
    for (let i = 0; i < 30; i++) await addTx(A, { amount: 10_000 + i, description: `giao dịch ${i}` });
    await A.on(() => repo.update('transactions', keep.id, { note: 'đã sửa' }));
    await A.on(() => repo.softDelete('transactions', del.id));
    await sync(A);
    const before = await B.db.transactions.count();
    expect(before).toBe(2);
    expect((await sync(B)).status).toBe('synced');
    expect(await B.db.transactions.count()).toBe(32);
    expect((await getTx(B, keep.id))!.note).toBe('đã sửa');
    expect((await getTx(B, del.id))!.deletedAt).toBeTruthy();
  });

  it('hết phiên đăng nhập / không được phép / lỗi máy chủ: báo đúng, dữ liệu vẫn ở hàng đợi', async () => {
    await addTx(A);
    server.authExpired = true;
    expect((await sync(A)).status).toBe('auth');
    server.authExpired = false; server.forbidden = true;
    expect((await sync(A)).status).toBe('auth');
    server.forbidden = false; server.serverError = true;
    const r = await sync(A);
    expect(r.status).toBe('failed'); expect(r.errors[0]).toContain('500');
    expect(await A.db.outbox.count()).toBeGreaterThan(0);
    server.serverError = false;
    expect((await sync(A)).status).toBe('synced');
  });

  it('dữ liệu bị sửa trên máy chủ hoặc bị hoán đổi giữa các bản ghi bị phát hiện và bỏ qua', async () => {
    const t1 = await addTx(A, { description: 'một' }); const t2 = await addTx(A, { description: 'hai' });
    await sync(A);
    const k1 = `transactions:${t1.id}`, k2 = `transactions:${t2.id}`;
    // hoán đổi payload
    const p1 = server.rows.get(k1)!.payload;
    server.rows.get(k1)!.payload = server.rows.get(k2)!.payload;
    server.rows.get(k2)!.payload = p1;
    const r = await sync(B);
    expect(r.errors.filter((e) => e.includes('không giải mã được')).length).toBeGreaterThanOrEqual(2);
    expect(await getTx(B, t1.id)).toBeUndefined();
    // sửa bit
    const row = server.rows.get(k1)!; const o = JSON.parse(row.payload); const c = fromB64(o.c); c[0] = c[0]! ^ 1; o.c = toB64(c); row.payload = JSON.stringify(o);
    const r2 = await sync(B);
    expect(r2.status).not.toBe('conflict');
  });

  it('thiết bị không có khóa thì không đồng bộ được (no-key) và không đọc được gì', async () => {
    const C = makeDevice('C', server);
    const r = await sync(C);
    expect(r.status).toBe('no-key');
    expect(await C.on(() => hasKeys())).toBe(false);
  });

  it('thêm thiết bị bằng recovery key sai thất bại an toàn', async () => {
    const C = makeDevice('C', server);
    const wrong = (await import('../src/crypto/crypto')).generateRecoveryKey;
    const bad = await wrong();
    await expect(C.on(async () => unlockWithRecoveryKey(bad.display, await server.transport('C').getEnvelopes()))).rejects.toThrow(/Khóa khôi phục/);
    expect(await C.on(() => hasKeys())).toBe(false);
  });

  it('đổi khóa: dữ liệu mã hóa lại, thiết bị khác tự theo kịp qua chain, khóa khôi phục cũ hết tác dụng sau khi hoàn tất', async () => {
    const tx = await addTx(A);
    await sync(A); await sync(B);
    const rot = await A.on(async () => {
      const r = await rotateKeys();
      await server.transport('A').putEnvelopes(r.envelopes);
      const n = await A.engine.reencryptAll();
      expect(n).toBeGreaterThan(0);
      return r;
    });
    expect(rot.newVersion).toBe(2);
    expect((await sync(A)).status).toBe('synced');
    expect(new Set([...server.rows.values()].map((r) => r.keyVersion))).toEqual(new Set([2]));
    // B không nhập khóa khôi phục mới nhưng vẫn đọc được nhờ chain
    await addTx(A, { description: 'sau khi đổi khóa' });
    await sync(A);
    expect((await sync(B)).status).toBe('synced');
    expect((await B.db.transactions.toArray()).some((t) => t.description === 'sau khi đổi khóa')).toBe(true);
    expect(await getTx(B, tx.id)).toBeTruthy();
    // hoàn tất: xóa envelope cũ trên máy chủ
    await A.on(async () => { await server.transport('A').deleteEnvelopesBelow(2); await pruneOldEnvelopes(2); });
    expect(server.envelopes.every((e) => e.kv === 2 && e.kind === 'recovery')).toBe(true);
    // thiết bị mới với khóa khôi phục CŨ không mở được dữ liệu mới
    const C = makeDevice('C', server);
    await expect(C.on(async () => unlockWithRecoveryKey(recovery, await server.transport('C').getEnvelopes()))).rejects.toThrow();
    // nhưng khóa khôi phục MỚI thì mở được
    await C.on(async () => unlockWithRecoveryKey(rot.recoveryKey, await server.transport('C').getEnvelopes()));
    expect((await sync(C)).status).toBe('synced');
    expect((await C.db.transactions.count())).toBe(2);
  });

  it('dữ liệu mẫu không bao giờ được đồng bộ', async () => {
    await A.on(() => loadSampleData('2026-03-15'));
    await sync(A);
    const dump = [...server.rows.values()].length;
    await sync(B);
    expect(await B.db.transactions.filter((t) => t.isSample).count()).toBe(0);
    expect(await A.db.outbox.filter((o) => o.id.startsWith('sample-')).count()).toBe(0);
    expect(dump).toBeGreaterThan(0);
  });

  it('thời gian thử lại tăng dần và có trần', () => {
    expect([1, 2, 3, 4, 5, 10].map(retryDelaySec)).toEqual([5, 10, 20, 40, 80, 300]);
  });

  it('trạng thái chờ đồng bộ: có bản ghi trong hàng đợi cho tới khi máy chủ xác nhận', async () => {
    await addTx(A);
    expect(await A.on(() => A.engine.pendingCount())).toBeGreaterThan(0);
    await sync(A);
    expect(await A.on(() => A.engine.pendingCount())).toBe(0);
  });
});
