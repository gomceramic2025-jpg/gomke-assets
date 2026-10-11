/**
 * Động cơ đồng bộ (local-first):
 *   ghi cục bộ → hàng đợi (outbox) → mã hóa trên thiết bị → đẩy bản mã → máy chủ xác nhận → mới xóa khỏi hàng đợi.
 *   kéo bản mã mới (theo con trỏ seq) → giải mã cục bộ → áp dụng; nếu bản ghi cục bộ đang chờ đẩy mà khác → XUNG ĐỘT (không ghi đè).
 * Không bao giờ báo "đã đồng bộ" khi máy chủ chưa xác nhận.
 */
import { db, kvGet, kvSet, tableOf } from '../db/db';
import { SYNC_COLLECTIONS, schemaFor, type SyncCollection } from '../domain/schemas';
import { getKey, getLatestKey, followChains } from '../crypto/keystore';
import { CryptoError, openJson, randomId, sealJson } from '../crypto/crypto';
import { appendHistory, create as repoCreate } from '../db/repo';
import { TransportError, type RemoteRecord, type SyncStatus, type SyncTransport } from './types';

type AnyRec = Record<string, unknown> & { id: string; rev: number; createdAt: number; updatedAt: number; deletedAt: number | null; purged: boolean; isSample: boolean };

export interface SyncReport { status: SyncStatus; pushed: number; pulled: number; conflicts: number; errors: string[]; finishedAt: number }

const IGNORE = new Set(['rev', 'createdAt', 'updatedAt']);
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => !IGNORE.has(k) && o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
export const sameContent = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** Thời gian chờ thử lại tăng dần (giây): 5, 10, 20, … tối đa 300. */
export const retryDelaySec = (attempt: number): number => Math.min(300, 5 * 2 ** Math.max(0, attempt - 1));

export class SyncEngine {
  private running = false;
  constructor(private transport: SyncTransport, private device: { id: string; name: string }) {}

  async pendingCount(): Promise<number> { return db.outbox.count(); }
  async conflictCount(): Promise<number> { return db.conflicts.count(); }

  async syncOnce(): Promise<SyncReport> {
    if (this.running) return { status: 'syncing', pushed: 0, pulled: 0, conflicts: await this.conflictCount(), errors: [], finishedAt: Date.now() };
    this.running = true;
    const report: SyncReport = { status: 'syncing', pushed: 0, pulled: 0, conflicts: 0, errors: [], finishedAt: 0 };
    try {
      if (!(await getLatestKey())) { report.status = 'no-key'; return report; }
      await this.transport.touchDevice(this.device.id, this.device.name).catch(() => undefined);
      await this.push(report);
      await this.pull(report);
      report.conflicts = await this.conflictCount();
      const pending = await db.outbox.count();
      // mục kẹt vì xung đột không tính là "chưa gửi"; còn mục khác (phát sinh trong lúc đồng bộ) → chưa xong
      report.status = report.conflicts > 0 ? 'conflict' : pending > 0 ? 'syncing' : 'synced';
    } catch (e) {
      report.conflicts = await this.conflictCount();
      if (e instanceof TransportError) {
        report.errors.push(e.message);
        report.status = e.kind === 'network' ? 'offline' : e.kind === 'auth' || e.kind === 'forbidden' ? 'auth' : 'failed';
      } else if (e instanceof CryptoError && e.code === 'missing-key') {
        report.errors.push(e.message); report.status = 'no-key';
      } else {
        report.errors.push(e instanceof Error ? e.message : 'Lỗi không xác định'); report.status = 'failed';
      }
    } finally {
      report.finishedAt = Date.now();
      this.running = false;
      await kvSet('lastSyncReport', report);
      if (report.status === 'synced') await kvSet('lastSyncedAt', report.finishedAt);
    }
    return report;
  }

  private async push(report: SyncReport): Promise<void> {
    const items = await db.outbox.orderBy('queuedAt').toArray();
    for (const item of items) {
      if (await db.conflicts.get(item.key)) continue; // chờ người dùng xử lý
      const rec = (await tableOf(item.collection).get(item.id)) as AnyRec | undefined;
      if (!rec) { await db.outbox.delete(item.key); continue; }
      const k = await getLatestKey();
      if (!k) throw new CryptoError('Thiếu khóa mã hóa', 'missing-key');
      const payload = await sealJson(k.key, k.kv, `${item.collection}|${item.id}`, rec);
      let res;
      try {
        res = await this.transport.push({ collection: item.collection, recordId: item.id, opId: item.opId, baseRev: item.baseRev, deleted: rec.purged || !!rec.deletedAt, keyVersion: k.kv, payload });
      } catch (e) {
        await db.outbox.update(item.key, { attempts: item.attempts + 1, lastError: e instanceof Error ? e.message : 'lỗi' });
        throw e;
      }
      if (res.status === 'ok') {
        await db.transaction('rw', [db.outbox, db.syncMeta], async () => {
          await db.syncMeta.put({ key: item.key, serverRev: res.rev, serverSeq: res.seq });
          const now = await db.outbox.get(item.key);
          if (now && now.opId === item.opId) await db.outbox.delete(item.key);
          else if (now) await db.outbox.update(item.key, { baseRev: res.rev }); // người dùng sửa tiếp trong lúc đẩy
        });
        report.pushed++;
      } else if (res.record) {
        await this.handleRemote(res.record, report);
      } else {
        // máy chủ chưa có bản ghi nhưng ta tưởng có → đẩy lại như bản mới ở lần sau
        await db.outbox.update(item.key, { baseRev: 0, opId: randomId() });
        await db.syncMeta.delete(item.key);
      }
    }
  }

  private async pull(report: SyncReport): Promise<void> {
    let cursor = (await kvGet<number>('syncCursor')) ?? 0;
    for (;;) {
      const page = await this.transport.pull(cursor, 200);
      for (const r of page) {
        await this.handleRemote(r, report);
        cursor = Math.max(cursor, r.seq);
        await kvSet('syncCursor', cursor);
      }
      if (page.length < 200) break;
    }
  }

  private async keyFor(kv: number): Promise<CryptoKey> {
    let key = await getKey(kv);
    if (!key) {
      // có thể đã đổi khóa trên thiết bị khác → thử theo chain
      await followChains(await this.transport.getEnvelopes());
      key = await getKey(kv);
    }
    if (!key) throw new CryptoError(`Thiếu khóa phiên bản ${kv} — nhập khóa khôi phục để mở`, 'missing-key');
    return key;
  }

  private async handleRemote(remote: RemoteRecord, report: SyncReport): Promise<void> {
    const key = `${remote.collection}:${remote.recordId}`;
    const meta = await db.syncMeta.get(key);
    if (meta && meta.serverRev >= remote.rev) return; // đã biết
    const k = await this.keyFor(remote.keyVersion);
    let rec: AnyRec;
    try {
      rec = await openJson<AnyRec>(k, `${remote.collection}|${remote.recordId}`, remote.payload);
    } catch (e) {
      if (e instanceof CryptoError) { report.errors.push(`Bản ghi ${key} không giải mã được/bị sửa đổi — đã bỏ qua`); return; }
      throw e;
    }
    if (rec.id !== remote.recordId) { report.errors.push(`Bản ghi ${key} có ID không khớp — đã bỏ qua`); return; }
    if (!rec.purged && !schemaFor[remote.collection].safeParse(rec).success) { report.errors.push(`Bản ghi ${key} sai cấu trúc — đã bỏ qua`); return; }
    const ob = await db.outbox.get(key);
    const local = (await tableOf(remote.collection).get(remote.recordId)) as AnyRec | undefined;
    if (!ob) {
      await db.transaction('rw', [tableOf(remote.collection), db.syncMeta], async () => {
        await tableOf(remote.collection).put(rec as never);
        await db.syncMeta.put({ key, serverRev: remote.rev, serverSeq: remote.seq });
      });
      report.pulled++;
      return;
    }
    if (local && sameContent(local, rec)) {
      await db.transaction('rw', [db.outbox, db.syncMeta], async () => {
        await db.syncMeta.put({ key, serverRev: remote.rev, serverSeq: remote.seq });
        await db.outbox.delete(key);
      });
      return;
    }
    await db.conflicts.put({ key, collection: remote.collection, id: remote.recordId, local, remote: rec, remoteRev: remote.rev, detectedAt: Date.now() });
  }

  /** Người dùng chọn bản đúng cho một xung đột. 'both' chỉ dùng cho giao dịch: giữ bản này và thêm bản kia thành giao dịch mới. */
  async resolveConflict(key: string, choice: 'local' | 'remote' | 'both'): Promise<void> {
    const c = await db.conflicts.get(key);
    if (!c) return;
    const col = c.collection;
    if (choice === 'remote') {
      await db.transaction('rw', [tableOf(col), db.outbox, db.conflicts, db.syncMeta], async () => {
        await tableOf(col).put(c.remote as never);
        await db.syncMeta.put({ key, serverRev: c.remoteRev, serverSeq: 0 });
        await db.outbox.delete(key);
        await db.conflicts.delete(key);
      });
      await appendHistory(col, c.id, 'update', `Xung đột đồng bộ: chọn bản từ thiết bị khác (${col})`);
      return;
    }
    if (choice === 'both' && col !== 'transactions') throw new Error('Chỉ giao dịch mới có thể giữ cả hai bản');
    const remote = c.remote as AnyRec;
    await db.transaction('rw', [tableOf(col), db.outbox, db.conflicts, db.syncMeta], async () => {
      const local = (await tableOf(col).get(c.id)) as AnyRec;
      await tableOf(col).put({ ...local, rev: local.rev + 1, updatedAt: Date.now() } as never);
      await db.syncMeta.put({ key, serverRev: c.remoteRev, serverSeq: 0 });
      const ob = await db.outbox.get(key);
      await db.outbox.put({ key, collection: col, id: c.id, opId: randomId(), baseRev: c.remoteRev, queuedAt: ob?.queuedAt ?? Date.now(), attempts: 0 });
      await db.conflicts.delete(key);
    });
    if (choice === 'both' && !remote.purged && !remote.deletedAt) {
      const { id: _id, rev: _r, createdAt: _c, updatedAt: _u, deletedAt: _d, purged: _p, ...rest } = remote;
      await repoCreate('transactions', { ...rest, note: `${String(rest.note ?? '')} [Bản từ thiết bị khác khi xung đột — hãy kiểm tra có trùng không]`.trim().slice(0, 1000) } as never);
    }
    await appendHistory(col, c.id, 'update', `Xung đột đồng bộ: giữ bản trên thiết bị này${choice === 'both' ? ' và thêm bản từ thiết bị khác' : ''}`);
  }

  /** Sau khi đổi khóa: xếp mọi bản ghi (kể cả thùng rác, tombstone) vào hàng đợi để mã hóa lại bằng khóa mới. */
  async reencryptAll(): Promise<number> {
    let n = 0;
    for (const col of SYNC_COLLECTIONS as readonly SyncCollection[]) {
      const rows = (await tableOf(col).toArray()) as AnyRec[];
      for (const r of rows) {
        if (r.isSample) continue;
        const key = `${col}:${r.id}`;
        const ob = await db.outbox.get(key);
        const baseRev = ob?.baseRev ?? (await db.syncMeta.get(key))?.serverRev ?? 0;
        await db.outbox.put({ key, collection: col, id: r.id, opId: randomId(), baseRev, queuedAt: ob?.queuedAt ?? Date.now(), attempts: 0 });
        n++;
      }
    }
    return n;
  }
}
