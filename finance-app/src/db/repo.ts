/**
 * Repository cục bộ: điểm duy nhất ghi dữ liệu tài chính.
 *  - Kiểm tra bằng schema (zod) trước khi ghi.
 *  - Mỗi lần ghi: tăng rev, ghi lịch sử (chỉ thêm, không sửa), xếp vào hàng đợi đồng bộ (trừ dữ liệu mẫu).
 *  - Xóa = xóa mềm (thùng rác). Xóa vĩnh viễn chỉ để lại tombstone tối thiểu để đồng bộ.
 */
import { db, tableOf } from './db';
import { randomId } from '../crypto/crypto';
import { schemaFor, type RecordOf, type SyncCollection, type HistoryEntry } from '../domain/schemas';
import { checkContribution } from '../domain/goals';
import { totalMoney } from '../domain/calc';
import { todayIso } from '../domain/dates';

type AnyRec = { id: string; rev: number; createdAt: number; updatedAt: number; deletedAt: number | null; purged: boolean; isSample: boolean } & Record<string, unknown>;

export class RepoError extends Error {
  constructor(message: string, readonly issues: string[] = []) { super(message); this.name = 'RepoError'; }
}

const now = () => Date.now();

function parseOrThrow<C extends SyncCollection>(collection: C, value: unknown): RecordOf[C] {
  const r = schemaFor[collection].safeParse(value);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || '(bản ghi)'}: ${i.message}`);
    throw new RepoError(`Dữ liệu không hợp lệ: ${issues[0]}`, issues);
  }
  return r.data as RecordOf[C];
}

const SKIP_DIFF = new Set(['rev', 'updatedAt', 'createdAt']);
function short(v: unknown): unknown {
  if (typeof v === 'string') return v.length > 120 ? v.slice(0, 117) + '…' : v;
  if (Array.isArray(v)) return v.slice(0, 10).map(short);
  return v;
}
function diff(before: Record<string, unknown> | null, after: Record<string, unknown>): HistoryEntry['changes'] {
  const out: HistoryEntry['changes'] = [];
  const keys = new Set([...Object.keys(after), ...(before ? Object.keys(before) : [])]);
  for (const k of keys) {
    if (SKIP_DIFF.has(k)) continue;
    const a = before?.[k], b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, before: short(a), after: short(b) });
    if (out.length >= 40) break;
  }
  return out;
}

async function queue(collection: SyncCollection, rec: { id: string; isSample?: boolean }): Promise<void> {
  if (rec.isSample) return; // dữ liệu mẫu không bao giờ đồng bộ
  const key = `${collection}:${rec.id}`;
  const existing = await db.outbox.get(key);
  const baseRev = existing?.baseRev ?? (await db.syncMeta.get(key))?.serverRev ?? 0;
  await db.outbox.put({ key, collection, id: rec.id, opId: randomId(), baseRev, queuedAt: existing?.queuedAt ?? now(), attempts: 0 });
}

async function logHistory(collection: SyncCollection, recordId: string, action: HistoryEntry['action'], changes: HistoryEntry['changes'], summary: string, isSample: boolean): Promise<void> {
  if (collection === 'history') return;
  const t = now();
  const h: HistoryEntry = { id: randomId(), rev: 1, createdAt: t, updatedAt: t, deletedAt: null, purged: false, isSample, ts: t, collection, recordId, action, changes, summary };
  await db.history.add(h);
  await queue('history', h);
}

const WRITE_TABLES = () => [db.settings, db.accounts, db.categories, db.transactions, db.assets, db.goals, db.contributions, db.budgets, db.importBatches, db.history, db.outbox, db.syncMeta];

async function assertRefs<C extends SyncCollection>(collection: C, rec: RecordOf[C]): Promise<void> {
  if (collection === 'transactions') {
    const t = rec as RecordOf['transactions'];
    const acc = await db.accounts.get(t.accountId);
    if (!acc || acc.deletedAt || acc.purged) throw new RepoError('Tài khoản không tồn tại hoặc đã bị xóa');
    if (t.toAccountId) {
      const to = await db.accounts.get(t.toAccountId);
      if (!to || to.deletedAt || to.purged) throw new RepoError('Tài khoản đích không tồn tại hoặc đã bị xóa');
    }
    if (t.categoryId) {
      const c = await db.categories.get(t.categoryId);
      if (!c || c.purged) throw new RepoError('Danh mục không tồn tại');
      if (t.type === 'income' && c.kind !== 'income') throw new RepoError('Giao dịch thu nhập cần danh mục thu nhập');
      if (t.type === 'expense' && c.kind !== 'expense') throw new RepoError('Giao dịch chi phí cần danh mục chi phí');
    }
  }
  if (collection === 'contributions') {
    const c = rec as RecordOf['contributions'];
    const g = await db.goals.get(c.goalId);
    if (!g || g.deletedAt || g.purged) throw new RepoError('Mục tiêu không tồn tại hoặc đã bị xóa');
    const [accs, txs, existing] = await Promise.all([db.accounts.toArray(), db.transactions.toArray(), db.contributions.toArray()]);
    const money = totalMoney(accs.filter((a) => !a.deletedAt && !a.purged), txs, todayIso());
    const srcTx = c.sourceTxId ? txs.find((t) => t.id === c.sourceTxId) : undefined;
    const chk = checkContribution(c, existing, money, srcTx?.amount);
    if (!chk.ok) throw new RepoError(chk.errors[0]!, chk.errors);
  }
}

export async function create<C extends SyncCollection>(collection: C, input: Partial<RecordOf[C]> & Record<string, unknown>, opts: { id?: string; history?: boolean } = {}): Promise<RecordOf[C]> {
  const t = now();
  const draft = { recordedAt: t, ...input, id: opts.id ?? (input.id as string | undefined) ?? randomId(), rev: 1, createdAt: t, updatedAt: t, deletedAt: null, purged: false };
  const rec = parseOrThrow(collection, draft);
  return db.transaction('rw', WRITE_TABLES(), async () => {
    await assertRefs(collection, rec);
    if (await tableOf(collection).get(rec.id)) throw new RepoError('ID đã tồn tại');
    await tableOf(collection).add(rec as unknown as AnyRec);
    if (opts.history !== false) await logHistory(collection, rec.id, 'create', diff(null, rec as unknown as Record<string, unknown>).slice(0, 12), `Tạo ${collection}`, rec.isSample);
    await queue(collection, rec);
    return rec;
  });
}

export async function update<C extends SyncCollection>(collection: C, id: string, patch: Partial<RecordOf[C]> & Record<string, unknown>): Promise<RecordOf[C]> {
  return db.transaction('rw', WRITE_TABLES(), async () => {
    const cur = (await tableOf(collection).get(id)) as AnyRec | undefined;
    if (!cur || cur.purged) throw new RepoError('Không tìm thấy bản ghi');
    const next = parseOrThrow(collection, { ...cur, ...patch, id, rev: cur.rev + 1, createdAt: cur.createdAt, updatedAt: now(), purged: false });
    await assertRefs(collection, next);
    await tableOf(collection).put(next as unknown as AnyRec);
    const changes = diff(cur, next as unknown as Record<string, unknown>);
    if (changes.length) await logHistory(collection, id, 'update', changes, `Sửa ${collection}`, next.isSample);
    await queue(collection, next);
    return next;
  });
}

export async function softDelete(collection: SyncCollection, id: string): Promise<void> {
  await db.transaction('rw', WRITE_TABLES(), async () => {
    const cur = (await tableOf(collection).get(id)) as AnyRec | undefined;
    if (!cur || cur.purged) throw new RepoError('Không tìm thấy bản ghi');
    if (cur.deletedAt) return;
    if (collection === 'accounts') {
      const used = await db.transactions.where('accountId').equals(id).filter((t) => !t.deletedAt && !t.purged).count();
      if (used > 0) throw new RepoError('Tài khoản còn giao dịch — hãy lưu trữ (ẩn) thay vì xóa');
    }
    const next = { ...cur, deletedAt: now(), rev: cur.rev + 1, updatedAt: now() };
    await tableOf(collection).put(next);
    await logHistory(collection, id, 'delete', [], `Chuyển ${collection} vào thùng rác`, cur.isSample);
    await queue(collection, next);
  });
}

export async function restore(collection: SyncCollection, id: string): Promise<void> {
  await db.transaction('rw', WRITE_TABLES(), async () => {
    const cur = (await tableOf(collection).get(id)) as AnyRec | undefined;
    if (!cur || cur.purged) throw new RepoError('Không tìm thấy bản ghi');
    if (!cur.deletedAt) return;
    const next = { ...cur, deletedAt: null, rev: cur.rev + 1, updatedAt: now() };
    parseOrThrow(collection, next);
    await assertRefs(collection, next as never);
    await tableOf(collection).put(next);
    await logHistory(collection, id, 'restore', [], `Khôi phục ${collection} từ thùng rác`, cur.isSample);
    await queue(collection, next);
  });
}

/** Xóa vĩnh viễn: chỉ cho bản ghi đang ở thùng rác. Chỉ giữ tombstone {id, rev, purged} để đồng bộ. */
export async function purge(collection: SyncCollection, id: string): Promise<void> {
  await db.transaction('rw', WRITE_TABLES(), async () => {
    const cur = (await tableOf(collection).get(id)) as AnyRec | undefined;
    if (!cur) throw new RepoError('Không tìm thấy bản ghi');
    if (cur.purged) return;
    if (!cur.deletedAt) throw new RepoError('Chỉ xóa vĩnh viễn được bản ghi đang ở thùng rác');
    if (cur.isSample) { await tableOf(collection).delete(id); return; } // mẫu: chưa từng đồng bộ
    const stub = { id, rev: cur.rev + 1, createdAt: cur.createdAt, updatedAt: now(), deletedAt: cur.deletedAt, purged: true, isSample: false };
    await tableOf(collection).put(stub as never);
    await logHistory(collection, id, 'purge', [], `Xóa vĩnh viễn ${collection}`, false);
    await queue(collection, stub);
  });
}

/** Ghi nhiều giao dịch trong MỘT giao dịch cơ sở dữ liệu: hoặc tất cả hoặc không gì cả. */
export async function importTransactions(
  batch: Omit<RecordOf['importBatches'], 'id' | 'rev' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'purged' | 'isSample'>,
  txInputs: Array<Record<string, unknown>>,
  hooks: { beforeCommit?: () => void } = {},
): Promise<{ batchId: string; count: number }> {
  const t = now();
  const batchId = randomId();
  const batchRec = parseOrThrow('importBatches', { ...batch, id: batchId, rev: 1, createdAt: t, updatedAt: t, deletedAt: null, purged: false, rowCount: txInputs.length });
  const txRecs = txInputs.map((x) => parseOrThrow('transactions', {
    ...x, id: randomId(), rev: 1, createdAt: t, updatedAt: t, recordedAt: t, deletedAt: null, purged: false, importBatchId: batchId, status: 'confirmed',
  }));
  return db.transaction('rw', WRITE_TABLES(), async () => {
    for (const r of txRecs) await assertRefs('transactions', r);
    await db.importBatches.add(batchRec);
    await queue('importBatches', batchRec);
    await db.transactions.bulkAdd(txRecs);
    for (const r of txRecs) await queue('transactions', r);
    await logHistory('importBatches', batchId, 'import', [], `Nhập ${txRecs.length} giao dịch từ ${batch.fileName}`, false);
    hooks.beforeCommit?.();
    return { batchId, count: txRecs.length };
  });
}

/** Chuyển cả lô nhập vào thùng rác (hoàn tác nhập). */
export async function undoImportBatch(batchId: string): Promise<number> {
  const txs = await db.transactions.where('importBatchId').equals(batchId).filter((x) => !x.deletedAt && !x.purged).toArray();
  await db.transaction('rw', WRITE_TABLES(), async () => {
    for (const x of txs) await softDelete('transactions', x.id);
    await softDelete('importBatches', batchId);
  });
  return txs.length;
}

// ---- Thao tác ghi cấp thấp cho đồng bộ (KHÔNG tạo outbox/lịch sử) ----
export async function applyRemoteRecord(collection: SyncCollection, rec: AnyRec): Promise<void> {
  await tableOf(collection).put(rec);
}

export async function listLive<C extends SyncCollection>(collection: C): Promise<RecordOf[C][]> {
  const all = (await tableOf(collection).toArray()) as unknown as AnyRec[];
  return all.filter((r) => !r.deletedAt && !r.purged) as unknown as RecordOf[C][];
}
export async function listTrash<C extends SyncCollection>(collection: C): Promise<RecordOf[C][]> {
  const all = (await tableOf(collection).toArray()) as unknown as AnyRec[];
  return all.filter((r) => r.deletedAt && !r.purged) as unknown as RecordOf[C][];
}

/** Ghi một dòng lịch sử (chỉ thêm) — dùng cho các sự kiện ngoài CRUD như giải quyết xung đột, khôi phục sao lưu. */
export async function appendHistory(collection: string, recordId: string, action: HistoryEntry['action'], summary: string): Promise<void> {
  await db.transaction('rw', [db.history, db.outbox, db.syncMeta], async () => {
    await logHistory(collection as SyncCollection, recordId, action, [], summary, false);
  });
}

export async function queueForSync(collection: SyncCollection, id: string): Promise<void> {
  const rec = (await tableOf(collection).get(id)) as AnyRec | undefined;
  if (rec) await queue(collection, rec);
}
