import Dexie, { type Table } from 'dexie';
import type { RecordOf, SyncCollection } from '../domain/schemas';
import type { Envelope, Sealed } from '../crypto/crypto';

export interface OutboxItem { key: string; collection: SyncCollection; id: string; opId: string; baseRev: number; queuedAt: number; attempts: number; lastError?: string }
export interface SyncMetaItem { key: string; serverRev: number; serverSeq: number }
export interface ConflictItem {
  key: string; collection: SyncCollection; id: string;
  local: unknown; remote: unknown; remoteRev: number; detectedAt: number;
}
export interface KeyringItem { kv: number; key: CryptoKey; createdAt: number }
export type EnvelopeKind = 'recovery' | 'chain';
export interface EnvelopeItem { id: string; kv: number; kind: EnvelopeKind; envelope: Envelope | Sealed; createdAt: number }
export interface BackupItem { id: string; createdAt: number; ok: boolean; size: number; encrypted: boolean; checksum: string; data: string; note: string; counts: Record<string, number> }
export interface KvItem { k: string; v: unknown }

export class FinanceDB extends Dexie {
  settings!: Table<RecordOf['settings'], string>;
  accounts!: Table<RecordOf['accounts'], string>;
  categories!: Table<RecordOf['categories'], string>;
  transactions!: Table<RecordOf['transactions'], string>;
  assets!: Table<RecordOf['assets'], string>;
  goals!: Table<RecordOf['goals'], string>;
  contributions!: Table<RecordOf['contributions'], string>;
  budgets!: Table<RecordOf['budgets'], string>;
  importBatches!: Table<RecordOf['importBatches'], string>;
  history!: Table<RecordOf['history'], string>;
  outbox!: Table<OutboxItem, string>;
  syncMeta!: Table<SyncMetaItem, string>;
  conflicts!: Table<ConflictItem, string>;
  keyring!: Table<KeyringItem, number>;
  envelopes!: Table<EnvelopeItem, string>;
  backups!: Table<BackupItem, string>;
  kv!: Table<KvItem, string>;

  constructor(name = 'gomke-finance') {
    super(name);
    // Phiên bản schema + migration. Khi đổi cấu trúc: thêm this.version(n+1).stores(...).upgrade(...) — KHÔNG sửa phiên bản cũ.
    this.version(1).stores({
      settings: 'id',
      accounts: 'id, deletedAt, isSample',
      categories: 'id, kind, deletedAt, isSample',
      transactions: 'id, date, accountId, categoryId, importBatchId, deletedAt, isSample, [accountId+date]',
      assets: 'id, deletedAt, isSample',
      goals: 'id, priority, deletedAt, isSample',
      contributions: 'id, goalId, sourceTxId, deletedAt, isSample',
      budgets: 'id, categoryId, deletedAt, isSample',
      importBatches: 'id, deletedAt, isSample',
      history: 'id, ts, collection, recordId',
      outbox: 'key, collection, queuedAt',
      syncMeta: 'key',
      conflicts: 'key, collection',
      keyring: 'kv',
      envelopes: 'id, kv',
      backups: 'id, createdAt',
      kv: 'k',
    });
  }
}

export let db = new FinanceDB();
/** Dùng trong test để tách cơ sở dữ liệu. */
export function setDatabase(instance: FinanceDB): void { db = instance; }

export const SYNCED_TABLES: SyncCollection[] = ['settings', 'accounts', 'categories', 'transactions', 'assets', 'goals', 'contributions', 'budgets', 'importBatches', 'history'];
export const tableOf = (c: SyncCollection) => db.table(c) as Table<{ id: string; rev: number } & Record<string, unknown>, string>;

export async function kvGet<T>(k: string): Promise<T | undefined> { return (await db.kv.get(k))?.v as T | undefined; }
export async function kvSet(k: string, v: unknown): Promise<void> { await db.kv.put({ k, v }); }
