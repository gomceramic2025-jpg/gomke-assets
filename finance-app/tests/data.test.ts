import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshDb } from './helpers/fresh';
import { db } from '../src/db/db';
import * as repo from '../src/db/repo';
import { loadSampleData, removeSampleData, hasSampleData } from '../src/db/seed';
import { buildBackup, createLocalBackup, previewBackup, readBackup, restoreBackup, runAutoBackupIfDue, lastGoodBackup, BackupError } from '../src/io/backup';
import { createKeys, unlockWithRecoveryKey, clearKeys } from '../src/crypto/keystore';
import { DriveBackupClient, DriveError } from '../src/io/drive';
import { buildAiContext, prepareRequest, askAi, redact, AiError, MAX_AI_PAYLOAD_BYTES } from '../src/ai/llm';
import { analyzeRules } from '../src/ai/rules';
import { accountBalances, totalMoney } from '../src/domain/calc';
import { cashflowReport } from '../src/domain/calc';

const tx = (o: Record<string, unknown> = {}) => repo.create('transactions', { type: 'expense', amount: 100_000, date: '2026-03-05', accountId: 'acc-bank', categoryId: 'cat-exp-living', description: 'Cà phê', ...o });

beforeEach(async () => { await freshDb(); });

describe('repository, thùng rác và lịch sử', () => {
  it('tạo/sửa ghi lịch sử với giá trị trước-sau; lịch sử không có API sửa', async () => {
    const t = await tx();
    await repo.update('transactions', t.id, { amount: 120_000 });
    const h = (await db.history.where('recordId').equals(t.id).toArray()).sort((a, b) => a.ts - b.ts);
    expect(h.map((x) => x.action)).toEqual(['create', 'update']);
    expect(h[1]!.changes).toEqual([{ field: 'amount', before: 100_000, after: 120_000 }]);
    expect(Object.keys(repo)).not.toContain('updateHistory');
  });
  it('xóa → thùng rác → khôi phục; xóa vĩnh viễn cần ở thùng rác trước', async () => {
    const t = await tx();
    await expect(repo.purge('transactions', t.id)).rejects.toThrow(/thùng rác/);
    await repo.softDelete('transactions', t.id);
    expect(await repo.listLive('transactions')).toHaveLength(0);
    expect((await repo.listTrash('transactions'))[0]!.deletedAt).toBeTruthy();
    await repo.restore('transactions', t.id);
    expect(await repo.listLive('transactions')).toHaveLength(1);
    await repo.softDelete('transactions', t.id);
    await repo.purge('transactions', t.id);
    expect(await repo.listTrash('transactions')).toHaveLength(0);
    const stub = (await db.transactions.get(t.id))!;
    expect(stub.purged).toBe(true);
    expect(JSON.stringify(stub)).not.toContain('Cà phê');
    const acts = (await db.history.where('recordId').equals(t.id).toArray()).map((h) => h.action);
    expect(acts).toEqual(expect.arrayContaining(['create', 'delete', 'restore', 'purge']));
  });
  it('giao dịch đã xóa không tính vào số dư', async () => {
    const t = await tx({ type: 'income', amount: 1_000_000, categoryId: 'cat-inc-gomke' });
    const accs = await repo.listLive('accounts');
    expect(totalMoney(accs, await db.transactions.toArray(), '2026-12-31')).toBe(1_000_000);
    await repo.softDelete('transactions', t.id);
    expect(totalMoney(accs, await db.transactions.toArray(), '2026-12-31')).toBe(0);
  });
  it('kiểm tra ràng buộc: tài khoản/danh mục sai, số lẻ, tài khoản còn giao dịch không xóa được', async () => {
    await expect(tx({ accountId: 'khong-co-that' })).rejects.toThrow(/Tài khoản/);
    await expect(tx({ categoryId: 'cat-inc-gomke' })).rejects.toThrow(/danh mục chi phí/);
    await expect(tx({ amount: 10.5 })).rejects.toThrow(/nguyên/);
    await tx();
    await expect(repo.softDelete('accounts', 'acc-bank')).rejects.toThrow(/lưu trữ/);
  });
  it('chuyển tiền nội bộ giữa hai tài khoản không đổi thu/chi nhưng đổi số dư', async () => {
    await tx({ type: 'income', amount: 2_000_000, categoryId: 'cat-inc-gomke' });
    await repo.create('transactions', { type: 'transfer', amount: 500_000, date: '2026-03-06', accountId: 'acc-bank', toAccountId: 'acc-cash', categoryId: null });
    const b = accountBalances(await repo.listLive('accounts'), await db.transactions.toArray(), '2026-03-31');
    expect([b.get('acc-bank'), b.get('acc-cash')]).toEqual([1_500_000, 500_000]);
    const cf = cashflowReport(await repo.listLive('accounts'), await db.transactions.toArray(), '2026-03-01', '2026-03-31');
    expect(cf.inflow).toBe(2_000_000); expect(cf.outflow).toBe(0); expect(cf.closing).toBe(2_000_000);
  });
});

describe('mục tiêu: một đồng chỉ thuộc một mục tiêu', () => {
  it('không phân bổ vượt số tiền đang có; không gán cùng giao dịch hai lần', async () => {
    const inc = await tx({ type: 'income', amount: 1_000_000, categoryId: 'cat-inc-gomke' });
    await repo.create('contributions', { goalId: 'goal-reserve', amount: 600_000, date: '2026-03-06' });
    await expect(repo.create('contributions', { goalId: 'goal-car', amount: 500_000, date: '2026-03-06' })).rejects.toThrow(/Chỉ còn/);
    await repo.create('contributions', { goalId: 'goal-car', amount: 400_000, date: '2026-03-06', sourceTxId: inc.id });
    await expect(repo.create('contributions', { goalId: 'goal-car', amount: 1, date: '2026-03-06', sourceTxId: inc.id })).rejects.toThrow();
  });
});

describe('dữ liệu mẫu', () => {
  it('nạp có nhãn, tính được số liệu, xóa riêng sạch sẽ mà không đụng dữ liệu thật', async () => {
    await tx({ description: 'Giao dịch thật' });
    const { transactions } = await loadSampleData('2026-03-15');
    expect(transactions).toBeGreaterThan(30);
    expect(await hasSampleData()).toBe(true);
    expect((await db.transactions.toArray()).filter((t) => t.isSample).every((t) => t.source === 'sample')).toBe(true);
    expect(await db.outbox.filter((o) => o.id.startsWith('sample-')).count()).toBe(0);
    await removeSampleData();
    expect(await hasSampleData()).toBe(false);
    const left = await db.transactions.toArray();
    expect(left).toHaveLength(1); expect(left[0]!.description).toBe('Giao dịch thật');
    expect(await db.budgets.count()).toBe(0);
  });
});

describe('sao lưu và khôi phục', () => {
  beforeEach(async () => { await tx(); await tx({ amount: 250_000, description: 'B' }); });

  it('tạo bản sao lưu, xác minh toàn vẹn; phát hiện tệp hỏng/sửa', async () => {
    const { text, file } = await buildBackup();
    expect(file.encrypted).toBe(false); // chưa có khóa → rõ ràng là chưa mã hóa
    expect((await readBackup(text)).data.collections.transactions).toHaveLength(2);
    const tampered = text.replace('Cà phê', 'Cà phé');
    await expect(readBackup(tampered)).rejects.toMatchObject({ code: 'checksum' });
    await expect(readBackup(text.slice(0, 100))).rejects.toMatchObject({ code: 'format' });
    await expect(readBackup('{"format":"khac"}')).rejects.toMatchObject({ code: 'format' });
    await expect(readBackup(JSON.stringify({ ...file, version: 99 }))).rejects.toMatchObject({ code: 'version' });
  });

  it('khôi phục "thay thế": đưa dữ liệu về đúng bản sao lưu, bản mới hơn vào thùng rác, có bản an toàn trước đó', async () => {
    const { text } = await buildBackup();
    const extra = await tx({ amount: 999_000, description: 'Phát sinh sau sao lưu' });
    const preview = await previewBackup(text);
    expect(preview.counts.transactions).toBe(2);
    const r = await restoreBackup(text, 'replace');
    expect(r.softDeleted).toBeGreaterThanOrEqual(1);
    expect(r.safetyBackupId).toBeTruthy();
    const live = await repo.listLive('transactions');
    expect(live).toHaveLength(2);
    expect((await db.transactions.get(extra.id))!.deletedAt).toBeTruthy(); // không mất, nằm thùng rác
    // bản an toàn khôi phục lại được trạng thái trước
    const safety = (await db.backups.get(r.safetyBackupId!))!;
    expect((await readBackup(safety.data)).data.collections.transactions).toHaveLength(3);
  });

  it('khôi phục "gộp" không nhân đôi giao dịch (theo ID), chạy hai lần vẫn giữ nguyên số lượng', async () => {
    const { text } = await buildBackup();
    const r1 = await restoreBackup(text, 'merge');
    expect(r1.added).toBe(0);
    await db.transactions.clear();
    const r2 = await restoreBackup(text, 'merge');
    expect(r2.added).toBeGreaterThanOrEqual(2);
    await restoreBackup(text, 'merge');
    expect(await db.transactions.count()).toBe(2);
  });

  it('bản sao lưu hỏng giữa chừng không làm thay đổi dữ liệu hiện tại', async () => {
    const { text, file } = await buildBackup();
    const bad = JSON.parse(text); const data = JSON.parse(bad.data); data.collections.transactions[0].amount = 1.5; bad.data = JSON.stringify(data);
    bad.checksum = await (await import('../src/crypto/crypto')).sha256Hex(bad.data);
    await expect(restoreBackup(JSON.stringify(bad), 'replace')).rejects.toBeInstanceOf(BackupError);
    expect(await db.transactions.count()).toBe(2);
    expect(file.counts.transactions).toBe(2);
  });

  it('mã hóa: không lộ nội dung; thiếu khóa thì không mở; mở được bằng recovery key trên thiết bị mới', async () => {
    const { recoveryKey } = await createKeys();
    const { text, file } = await buildBackup();
    expect(file.encrypted).toBe(true);
    expect(text).not.toContain('Cà phê'); expect(text).not.toContain('250000'); expect(text).not.toContain(recoveryKey);
    // thiết bị mới (mất khóa cục bộ)
    await clearKeys();
    await expect(readBackup(text)).rejects.toMatchObject({ code: 'key' });
    await expect(readBackup(text, { recoveryKey: 'AAAA-AAAA' })).rejects.toBeInstanceOf(BackupError);
    const ok = await readBackup(text, { recoveryKey });
    expect(ok.data.collections.transactions).toHaveLength(2);
    // sửa 1 ký tự bản mã → phát hiện
    const o = JSON.parse(text); o.sealed.c = (o.sealed.c[0] === 'A' ? 'B' : 'A') + o.sealed.c.slice(1);
    await createKeys().catch(() => undefined);
    await expect(readBackup(JSON.stringify(o), { recoveryKey })).rejects.toMatchObject({ code: 'key' });
  });

  it('sao lưu cục bộ: giữ N bản, chỉ dọn sau khi bản mới tốt; bản lỗi không xóa bản tốt', async () => {
    for (let i = 0; i < 5; i++) await createLocalBackup(`b${i}`, { now: 1_000 + i, keep: 3 });
    expect((await db.backups.toArray()).filter((b) => b.ok)).toHaveLength(3);
    const good = await lastGoodBackup();
    // gây lỗi: bảng settings hỏng khiến build/verify thất bại → bản tốt cũ còn nguyên
    const realTable = db.table.bind(db);
    const spy = vi.spyOn(db, 'table').mockImplementation(((n: string) => { if (n === 'transactions') throw new Error('đĩa lỗi'); return realTable(n); }) as never);
    await expect(createLocalBackup('lỗi', { now: 9_999 })).rejects.toThrow('đĩa lỗi');
    spy.mockRestore();
    expect((await lastGoodBackup())!.id).toBe(good!.id);
    expect((await db.backups.toArray()).filter((b) => b.ok)).toHaveLength(3);
    expect((await db.backups.toArray()).some((b) => !b.ok)).toBe(true);
  });

  it('tự động hằng ngày: chạy khi đã quá 24h, không chạy khi chưa tới hạn hoặc bị tắt', async () => {
    const t0 = Date.UTC(2026, 2, 1);
    expect(await runAutoBackupIfDue(t0)).toBe('created');
    expect(await runAutoBackupIfDue(t0 + 3600_000)).toBe('not-due');
    expect(await runAutoBackupIfDue(t0 + 25 * 3600_000)).toBe('created');
    await repo.update('settings', 'settings-main', { autoBackup: false });
    expect(await runAutoBackupIfDue(t0 + 99 * 3600_000)).toBe('disabled');
  });
});

describe('sao lưu Google Drive (máy chủ giả lập; chưa thử với Google thật)', () => {
  function fakeDrive() {
    const files = new Map<string, { meta: Record<string, unknown>; body: string; created: number }>();
    let n = 0; let corrupt = false;
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const u = new URL(url); const auth = (init.headers as Record<string, string>).Authorization;
      if (auth !== 'Bearer tok') return new Response('', { status: 401 });
      if (init.method === 'POST' && u.pathname.startsWith('/upload')) {
        const body = String(init.body); const parts = body.split(/--gk\w+/);
        const meta = JSON.parse(parts[1]!.split('\r\n\r\n')[1]!.trim());
        const content = parts[2]!.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
        const id = `f${++n}`; files.set(id, { meta, body: corrupt ? content.slice(0, -5) : content, created: n });
        return Response.json({ id, name: meta.name, createdTime: new Date(n * 1000).toISOString(), appProperties: meta.appProperties });
      }
      if (init.method === 'DELETE') { files.delete(decodeURIComponent(u.pathname.split('/').pop()!)); return new Response(null, { status: 204 }); }
      if (u.searchParams.get('alt') === 'media') return new Response(files.get(decodeURIComponent(u.pathname.split('/').pop()!))!.body);
      return Response.json({ files: [...files.entries()].sort((a, b) => b[1].created - a[1].created).map(([id, f]) => ({ id, name: f.meta.name, createdTime: new Date(f.created * 1000).toISOString(), appProperties: f.meta.appProperties })) });
    }) as unknown as typeof fetch;
    return { files, fetchImpl, setCorrupt: (v: boolean) => { corrupt = v; } };
  }
  beforeEach(async () => { await tx(); });

  it('chưa kết nối → báo rõ, không làm gì', async () => {
    const c = new DriveBackupClient(() => null, fakeDrive().fetchImpl);
    await expect(c.list()).rejects.toMatchObject({ code: 'not-connected' });
  });
  it('mặc định từ chối tải bản chưa mã hóa', async () => {
    const c = new DriveBackupClient(() => 'tok', fakeDrive().fetchImpl);
    await expect(c.backupNow()).rejects.toMatchObject({ code: 'unencrypted' });
  });
  it('tải bản mã hóa, kiểm tra toàn vẹn, giữ lịch sử nhiều bản, khôi phục được; khóa không bị tải lên', async () => {
    const { recoveryKey } = await createKeys();
    const d = fakeDrive(); const c = new DriveBackupClient(() => 'tok', d.fetchImpl);
    for (let i = 0; i < 4; i++) await c.backupNow({ keep: 3, now: 1_700_000_000_000 + i * 1000 });
    expect((await c.list()).length).toBe(3);
    for (const f of d.files.values()) { expect(f.body).not.toContain('Cà phê'); expect(f.body).not.toContain(recoveryKey); expect(f.meta.appProperties).toMatchObject({ encrypted: 'true' }); }
    const latest = (await c.list())[0]!;
    const text = await c.fetchForRestore(latest.id);
    expect((await restoreBackup(text, 'merge')).added).toBe(0);
  });
  it('bản tải lên không khớp → xóa bản lỗi, giữ bản cũ', async () => {
    await createKeys();
    const d = fakeDrive(); const c = new DriveBackupClient(() => 'tok', d.fetchImpl);
    await c.backupNow();
    d.setCorrupt(true);
    await expect(c.backupNow()).rejects.toBeInstanceOf(DriveError);
    expect(d.files.size).toBe(1);
  });
  it('token hết hạn (401) → yêu cầu kết nối lại', async () => {
    const c = new DriveBackupClient(() => 'sai', fakeDrive().fetchImpl);
    await expect(c.list()).rejects.toMatchObject({ code: 'not-connected' });
  });
  it('thiết bị khác có khóa khôi phục mở được bản trên Drive', async () => {
    const { recoveryKey } = await createKeys();
    const d = fakeDrive(); const c = new DriveBackupClient(() => 'tok', d.fetchImpl);
    await c.backupNow();
    await clearKeys();
    const id = (await c.list())[0]!.id;
    await expect(c.fetchForRestore(id)).rejects.toMatchObject({ code: 'key' });
    await expect(c.fetchForRestore(id, { recoveryKey })).resolves.toContain('gomke-finance-backup');
    void unlockWithRecoveryKey;
  });
});

describe('AI (tùy chọn) và phân tích theo quy tắc', () => {
  it('redact xóa email, số dài, token, sđt', () => {
    const r = redact('chuyển 0123456789012 tới a@b.com sđt 0912 345 678 key sk-abcdefghijklmnop');
    expect(r).not.toMatch(/0123456789012|a@b\.com|0912 345 678|sk-abcdefghijklmnop/);
  });
  it('ngữ cảnh gửi AI chỉ gồm số liệu tổng hợp, không có nội dung giao dịch', async () => {
    await loadSampleData('2026-03-15');
    const s = (await db.settings.get('settings-main'))!;
    const ctx = buildAiContext(await db.transactions.toArray(), await repo.listLive('categories'), await db.budgets.toArray(), await repo.listLive('goals'), s, '2026-03-15');
    const j = JSON.stringify(ctx);
    expect(j).not.toContain('(mẫu)'); expect(j).not.toContain('Gửi ba mẹ'); expect(j).not.toContain('acc-');
    expect(ctx.monthly.length).toBeGreaterThan(0);
    expect(prepareRequest('Tháng này tôi chi nhiều không?', ctx).bytes).toBeLessThan(MAX_AI_PAYLOAD_BYTES);
    expect(() => prepareRequest('x'.repeat(501), ctx)).toThrow(AiError);
    expect(() => prepareRequest('  ', ctx)).toThrow(AiError);
  });
  it('AI tắt / chưa đăng nhập / lỗi mạng / 429 / hủy: báo lỗi đúng, không ghi dữ liệu', async () => {
    const mk = (status: number, body: unknown = {}) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
    const base = { baseUrl: 'https://x.supabase.co', accessToken: 't' };
    await expect(askAi('{}', { ...base, enabled: false })).rejects.toMatchObject({ code: 'disabled' });
    await expect(askAi('{}', { ...base, enabled: true, accessToken: undefined, baseUrl: 'https://x' })).rejects.toBeInstanceOf(AiError);
    await expect(askAi('{}', { ...base, enabled: true, fetchImpl: mk(429, { error: 'Hết lượt' }) })).rejects.toMatchObject({ code: 'rate', message: 'Hết lượt' });
    await expect(askAi('{}', { ...base, enabled: true, fetchImpl: mk(403) })).rejects.toMatchObject({ code: 'auth' });
    await expect(askAi('{}', { ...base, enabled: true, fetchImpl: (async () => { throw new TypeError('x'); }) as never })).rejects.toMatchObject({ code: 'server' });
    const slow = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch;
    await expect(askAi('{}', { ...base, enabled: true, fetchImpl: slow, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
    const ctl = new AbortController(); const p = askAi('{}', { ...base, enabled: true, fetchImpl: slow, signal: ctl.signal }); ctl.abort();
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
    const ok = await askAi('{}', { ...base, enabled: true, fetchImpl: mk(200, { answer: 'ok', budgetSuggestions: [{ categoryId: 'c', monthlyLimit: 5.5, reason: 'x' }, { categoryId: 'c2', monthlyLimit: 1000, reason: 'y' }] }) });
    expect(ok.budgetSuggestions).toHaveLength(1); // số lẻ bị loại
    expect(await db.transactions.count()).toBe(0);
  });
  it('phân tích quy tắc: thiếu dữ liệu thì nói chưa đủ; có dữ liệu mẫu thì ra nhận định kèm bằng chứng', async () => {
    const input = async (today: string) => ({ today, accounts: await repo.listLive('accounts'), txs: await db.transactions.toArray(), categories: await repo.listLive('categories'), budgets: await db.budgets.toArray(), goals: await repo.listLive('goals'), contribs: await db.contributions.toArray(), settings: (await db.settings.get('settings-main'))! });
    expect((analyzeRules(await input('2026-03-15'))).enoughData).toBe(false);
    await loadSampleData('2026-03-15');
    const r = analyzeRules(await input('2026-03-15'));
    expect(r.enoughData).toBe(true);
    expect(r.insights.length).toBeGreaterThan(2);
    expect(r.insights.some((i) => i.id === 'reserve')).toBe(true);
  });
});
