/**
 * Sao lưu & khôi phục.
 *  - Tệp sao lưu: JSON có phiên bản + checksum SHA-256. Nếu thiết bị có khóa mã hóa → toàn bộ nội dung được mã hóa AES-256-GCM
 *    và đính kèm envelope (khóa dữ liệu đã bọc bằng khóa khôi phục) → chỉ cần khóa khôi phục là mở được trên máy mới.
 *  - Khóa giải mã/khóa khôi phục KHÔNG nằm trong tệp.
 *  - Sao lưu cục bộ lưu trong IndexedDB, giữ N bản tốt gần nhất; bản mới chỉ được tính sau khi kiểm tra đọc lại thành công.
 */
import { db, tableOf } from '../db/db';
import { SYNC_COLLECTIONS, schemaFor, SCHEMA_VERSION, type SyncCollection } from '../domain/schemas';
import { CryptoError, importDataKey, open, randomId, seal, sha256Hex, parseRecoveryKey, unwrapDataKey, type Envelope, type Sealed } from '../crypto/crypto';
import { getKey, getLatestKey, listEnvelopes, type StoredEnvelope } from '../crypto/keystore';
import { queueForSync } from '../db/repo';

export const BACKUP_FORMAT = 'gomke-finance-backup';
export const BACKUP_VERSION = 1;
const DAY = 24 * 3600 * 1000;

type Rec = { id: string; updatedAt: number; deletedAt: number | null; purged: boolean; isSample: boolean } & Record<string, unknown>;
export type BackupData = { collections: Record<string, Rec[]> };

export interface BackupFile {
  format: typeof BACKUP_FORMAT; version: number; schemaVersion: number; createdAt: number; appNote: string;
  encrypted: boolean; keyVersion?: number;
  counts: Record<string, number>;
  /** SHA-256 (hex) của chuỗi JSON dữ liệu (bản rõ) — dùng kiểm tra toàn vẹn sau khi giải mã */
  checksum: string;
  data?: string;      // khi không mã hóa
  sealed?: Sealed;    // khi mã hóa
  envelopes?: StoredEnvelope[];
}

export class BackupError extends Error {
  constructor(message: string, readonly code: 'format' | 'version' | 'checksum' | 'key' | 'invalid' | 'write') { super(message); this.name = 'BackupError'; }
}

export async function collectData(): Promise<BackupData> {
  const collections: Record<string, Rec[]> = {};
  for (const c of SYNC_COLLECTIONS as readonly SyncCollection[]) collections[c] = (await tableOf(c).toArray()) as unknown as Rec[];
  return { collections };
}

const countsOf = (d: BackupData) => Object.fromEntries(Object.entries(d.collections).map(([k, v]) => [k, v.length]));

export async function buildBackup(opts: { encrypt?: boolean; now?: number } = {}): Promise<{ text: string; file: BackupFile }> {
  const data = await collectData();
  const json = JSON.stringify(data);
  const checksum = await sha256Hex(json);
  const base = { format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: opts.now ?? Date.now(), appNote: 'Gốm Kể Finance', counts: countsOf(data), checksum } as const;
  const k = opts.encrypt === false ? null : await getLatestKey();
  let file: BackupFile;
  if (k) {
    const sealed = await seal(k.key, k.kv, 'backup', json);
    file = { ...base, encrypted: true, keyVersion: k.kv, sealed, envelopes: await listEnvelopes() };
  } else file = { ...base, encrypted: false, data: json };
  return { text: JSON.stringify(file), file };
}

export function parseBackupHeader(text: string): BackupFile {
  let f: BackupFile;
  try { f = JSON.parse(text) as BackupFile; } catch { throw new BackupError('Tệp sao lưu không phải JSON hợp lệ (có thể bị hỏng)', 'format'); }
  if (!f || f.format !== BACKUP_FORMAT) throw new BackupError('Đây không phải tệp sao lưu của ứng dụng này', 'format');
  if (typeof f.version !== 'number' || f.version > BACKUP_VERSION) throw new BackupError(`Tệp sao lưu phiên bản ${String(f.version)} mới hơn ứng dụng hiện tại — hãy cập nhật ứng dụng`, 'version');
  if (typeof f.createdAt !== 'number' || typeof f.checksum !== 'string') throw new BackupError('Tệp sao lưu thiếu thông tin bắt buộc', 'format');
  if (f.encrypted ? !f.sealed : typeof f.data !== 'string') throw new BackupError('Tệp sao lưu thiếu phần dữ liệu', 'format');
  return f;
}

/** Giải mã (nếu cần) và kiểm tra toàn vẹn + cấu trúc. recoveryKey chỉ cần khi thiết bị này chưa có khóa phù hợp. */
export async function readBackup(text: string, opts: { recoveryKey?: string } = {}): Promise<{ file: BackupFile; data: BackupData }> {
  const file = parseBackupHeader(text);
  let json: string;
  if (file.encrypted) {
    const sealed = file.sealed!;
    let key = await getKey(sealed.kv);
    if (!key && opts.recoveryKey) {
      const env = file.envelopes?.find((e) => e.kv === sealed.kv && e.kind === 'recovery');
      if (!env) throw new BackupError('Tệp sao lưu không kèm envelope khóa phù hợp', 'key');
      try { key = await importDataKey(await unwrapDataKey(env.envelope as Envelope, await parseRecoveryKey(opts.recoveryKey))); }
      catch (e) { throw new BackupError(e instanceof CryptoError ? e.message : 'Khóa khôi phục không đúng', 'key'); }
    }
    if (!key) throw new BackupError('Cần khóa giải mã: nhập khóa khôi phục để mở bản sao lưu này', 'key');
    try { json = new TextDecoder().decode(await open(key, 'backup', sealed)); }
    catch { throw new BackupError('Không giải mã được: sai khóa hoặc tệp đã bị sửa/hỏng', 'key'); }
  } else json = file.data!;
  if ((await sha256Hex(json)) !== file.checksum) throw new BackupError('Kiểm tra toàn vẹn thất bại: tệp sao lưu bị hỏng hoặc bị sửa', 'checksum');
  let data: BackupData;
  try { data = JSON.parse(json) as BackupData; } catch { throw new BackupError('Dữ liệu sao lưu hỏng', 'format'); }
  validateData(data);
  return { file, data };
}

function validateData(data: BackupData): void {
  if (!data || typeof data.collections !== 'object') throw new BackupError('Cấu trúc dữ liệu sao lưu không hợp lệ', 'invalid');
  for (const c of SYNC_COLLECTIONS as readonly SyncCollection[]) {
    const rows = data.collections[c];
    if (!Array.isArray(rows)) throw new BackupError(`Thiếu bảng "${c}" trong bản sao lưu`, 'invalid');
    for (const r of rows) {
      if (typeof r?.id !== 'string') throw new BackupError(`Bản ghi trong "${c}" thiếu ID`, 'invalid');
      if (r.purged) continue;
      const p = schemaFor[c].safeParse(r);
      if (!p.success) throw new BackupError(`Bản ghi ${r.id} trong "${c}" không hợp lệ: ${p.error.issues[0]?.message ?? ''}`, 'invalid');
    }
  }
}

export interface BackupPreview { createdAt: number; encrypted: boolean; counts: Record<string, number>; olderThanLocalByDays: number | null; latestLocalChange: number | null }
export async function previewBackup(text: string): Promise<BackupPreview> {
  const f = parseBackupHeader(text);
  let latest = 0;
  for (const c of SYNC_COLLECTIONS as readonly SyncCollection[]) {
    if (c === 'history') continue;
    for (const r of (await tableOf(c).toArray()) as unknown as Rec[]) latest = Math.max(latest, r.updatedAt ?? 0);
  }
  return { createdAt: f.createdAt, encrypted: f.encrypted, counts: f.counts, latestLocalChange: latest || null, olderThanLocalByDays: latest > f.createdAt ? Math.ceil((latest - f.createdAt) / DAY) : null };
}

export type RestoreMode = 'merge' | 'replace';
export interface RestoreResult { added: number; skippedExisting: number; softDeleted: number; safetyBackupId: string | null }

/**
 * Khôi phục.
 *  - merge: chỉ thêm bản ghi chưa có (theo ID) → không bao giờ nhân đôi giao dịch.
 *  - replace: dữ liệu hiện tại được thay bằng bản sao lưu; bản ghi hiện có mà bản sao lưu không có sẽ chuyển vào thùng rác (không xóa mất).
 * Luôn tạo một bản sao lưu an toàn của trạng thái hiện tại trước khi thay đổi, và ghi trong MỘT giao dịch DB.
 */
export async function restoreBackup(text: string, mode: RestoreMode, opts: { recoveryKey?: string } = {}): Promise<RestoreResult> {
  const { data } = await readBackup(text, opts); // lỗi → dừng, chưa đụng vào dữ liệu
  const safety = await createLocalBackup('Tự động trước khi khôi phục', { force: true });
  const now = Date.now();
  const res: RestoreResult = { added: 0, skippedExisting: 0, softDeleted: 0, safetyBackupId: safety?.id ?? null };
  const touched: Array<[SyncCollection, string]> = [];
  const tables = SYNC_COLLECTIONS.map((c) => tableOf(c));
  try {
    await db.transaction('rw', [...tables, db.outbox, db.syncMeta], async () => {
      for (const c of SYNC_COLLECTIONS as readonly SyncCollection[]) {
        const t = tableOf(c);
        const incoming = new Map(data.collections[c]!.map((r) => [r.id, r]));
        const existing = new Map(((await t.toArray()) as unknown as Rec[]).map((r) => [r.id, r]));
        for (const [id, r] of incoming) {
          const cur = existing.get(id);
          if (!cur) { await t.put(r as never); res.added++; touched.push([c, id]); continue; }
          if (mode === 'merge') { res.skippedExisting++; continue; }
          // replace: dùng bản trong sao lưu; tăng rev để thiết bị khác nhận thay đổi
          await t.put({ ...r, rev: Math.max((cur as { rev?: number }).rev ?? 1, (r as { rev?: number }).rev ?? 1) + 1, updatedAt: now } as never);
          res.added++; touched.push([c, id]);
        }
        if (mode === 'replace' && c !== 'history') {
          for (const [id, cur] of existing) {
            if (incoming.has(id) || cur.purged) continue;
            if (cur.isSample) { await t.delete(id); continue; }
            if (!cur.deletedAt) { await t.put({ ...cur, deletedAt: now, rev: ((cur as { rev?: number }).rev ?? 1) + 1, updatedAt: now } as never); res.softDeleted++; touched.push([c, id]); }
          }
        }
      }
    });
  } catch (e) {
    throw new BackupError(`Lỗi khi ghi dữ liệu khôi phục; dữ liệu hiện tại được giữ nguyên (${e instanceof Error ? e.message : 'không rõ'})`, 'write');
  }
  for (const [c, id] of touched) await queueForSync(c, id); // để thiết bị khác nhận
  return res;
}

// ---------- Sao lưu cục bộ (IndexedDB) ----------
export async function createLocalBackup(note = '', opts: { force?: boolean; now?: number; keep?: number } = {}) {
  const now = opts.now ?? Date.now();
  const settings = await db.settings.get('settings-main');
  const keep = opts.keep ?? settings?.backupKeep ?? 7;
  const id = randomId();
  try {
    const { text, file } = await buildBackup({ now });
    // kiểm tra: đọc lại được, giải mã được, checksum khớp
    await readBackup(text);
    await db.backups.add({ id, createdAt: now, ok: true, size: text.length, encrypted: file.encrypted, checksum: file.checksum, data: text, note, counts: file.counts });
    // chỉ SAU KHI bản mới tốt mới dọn bản cũ; luôn giữ ≥ 1 bản tốt
    const good = (await db.backups.orderBy('createdAt').reverse().toArray()).filter((b) => b.ok);
    const bad = (await db.backups.toArray()).filter((b) => !b.ok);
    const drop = [...good.slice(keep).map((b) => b.id), ...bad.filter((b) => now - b.createdAt > 7 * DAY).map((b) => b.id)];
    if (drop.length) await db.backups.bulkDelete(drop);
    return (await db.backups.get(id))!;
  } catch (e) {
    await db.backups.add({ id, createdAt: now, ok: false, size: 0, encrypted: false, checksum: '', data: '', note: `LỖI: ${e instanceof Error ? e.message : 'không rõ'}`, counts: {} });
    if (opts.force) return null;
    throw e;
  }
}

export async function lastGoodBackup() {
  return (await db.backups.orderBy('createdAt').reverse().toArray()).find((b) => b.ok) ?? null;
}

/** Chạy sao lưu hằng ngày nếu đã quá 24h kể từ bản tốt gần nhất. Chỉ chạy khi ứng dụng đang mở. */
export async function runAutoBackupIfDue(now = Date.now()): Promise<'created' | 'not-due' | 'disabled' | 'failed'> {
  const s = await db.settings.get('settings-main');
  if (!s?.autoBackup) return 'disabled';
  const last = await lastGoodBackup();
  if (last && now - last.createdAt < DAY) return 'not-due';
  try { await createLocalBackup('Tự động hằng ngày', { now }); return 'created'; } catch { return 'failed'; }
}
