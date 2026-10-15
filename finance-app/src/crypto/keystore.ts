/**
 * Quản lý khóa trên thiết bị.
 *  - Khóa dữ liệu (DEK) lưu trong IndexedDB dưới dạng CryptoKey KHÔNG XUẤT ĐƯỢC: mã độc/XSS chạy trong trang vẫn dùng được khóa
 *    trong phiên, nhưng không sao chép được giá trị khóa ra ngoài. (Không chống được kẻ có toàn quyền thiết bị đang mở khóa.)
 *  - Recovery key chỉ hiện đúng một lần lúc tạo; ứng dụng KHÔNG lưu nó ở bất kỳ đâu.
 *  - Envelope (DEK đã bọc) được lưu cục bộ và có thể đưa lên máy chủ/bản sao lưu.
 */
import { db, type EnvelopeItem, type EnvelopeKind } from '../db/db';
import {
  CryptoError, generateDataKeyBytes, generateRecoveryKey, importDataKey, open, parseRecoveryKey, seal, unwrapDataKey, wrapDataKey,
  fromB64, toB64, type Envelope, type Sealed,
} from './crypto';

export interface StoredEnvelope { kv: number; kind: EnvelopeKind; envelope: Envelope | Sealed }

export async function hasKeys(): Promise<boolean> { return (await db.keyring.count()) > 0; }
export async function latestKeyVersion(): Promise<number> {
  const all = await db.keyring.orderBy('kv').last();
  return all?.kv ?? 0;
}
export async function getKey(kv: number): Promise<CryptoKey | null> { return (await db.keyring.get(kv))?.key ?? null; }
export async function getLatestKey(): Promise<{ kv: number; key: CryptoKey } | null> {
  const k = await db.keyring.orderBy('kv').last();
  return k ? { kv: k.kv, key: k.key } : null;
}
export async function listEnvelopes(): Promise<StoredEnvelope[]> {
  return (await db.envelopes.toArray()).map((e: EnvelopeItem) => ({ kv: e.kv, kind: e.kind, envelope: e.envelope }));
}
async function saveEnvelope(e: StoredEnvelope): Promise<void> {
  await db.envelopes.put({ id: `${e.kv}:${e.kind}`, kv: e.kv, kind: e.kind, envelope: e.envelope, createdAt: Date.now() });
}

/** Lần đầu: tạo DEK + recovery key. Trả recovery key dạng hiển thị — người dùng PHẢI lưu ngay. */
export async function createKeys(): Promise<{ recoveryKey: string; envelopes: StoredEnvelope[] }> {
  if (await hasKeys()) throw new Error('Thiết bị đã có khóa mã hóa');
  const dek = await generateDataKeyBytes();
  const rk = await generateRecoveryKey();
  const env = await wrapDataKey(dek, 1, rk.raw);
  await db.keyring.put({ kv: 1, key: await importDataKey(dek), createdAt: Date.now() });
  const se: StoredEnvelope = { kv: 1, kind: 'recovery', envelope: env };
  await saveEnvelope(se);
  dek.fill(0); rk.raw.fill(0);
  return { recoveryKey: rk.display, envelopes: [se] };
}

/** Thiết bị mới: nhập recovery key + envelope tải từ máy chủ/bản sao lưu. */
export async function unlockWithRecoveryKey(recoveryKeyText: string, envelopes: StoredEnvelope[]): Promise<number[]> {
  const raw = await parseRecoveryKey(recoveryKeyText);
  const recov = envelopes.filter((e) => e.kind === 'recovery').sort((a, b) => a.kv - b.kv);
  if (!recov.length) throw new CryptoError('Không tìm thấy envelope khóa để mở', 'missing-key');
  const unlocked: number[] = [];
  let lastErr: unknown;
  for (const e of recov) {
    try {
      const dek = await unwrapDataKey(e.envelope as Envelope, raw);
      await db.keyring.put({ kv: e.kv, key: await importDataKey(dek), createdAt: Date.now() });
      await saveEnvelope(e);
      unlocked.push(e.kv);
      dek.fill(0);
    } catch (err) { lastErr = err; }
  }
  raw.fill(0);
  if (!unlocked.length) throw lastErr instanceof Error ? lastErr : new CryptoError('Khóa khôi phục không đúng', 'bad-key');
  await followChains(envelopes);
  return unlocked;
}

/** Thiết bị đã có khóa cũ: tự lấy khóa mới qua "chain" (khóa mới được mã hóa bằng khóa cũ). */
export async function followChains(envelopes: StoredEnvelope[]): Promise<number[]> {
  const got: number[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const e of envelopes.filter((x) => x.kind === 'chain').sort((a, b) => a.kv - b.kv)) {
      if (await db.keyring.get(e.kv)) continue;
      const sealed = e.envelope as Sealed & { from?: number };
      const prev = sealed.from ? await getKey(sealed.from) : null;
      if (!prev) continue;
      const raw = await open(prev, `chain|${e.kv}`, sealed);
      await db.keyring.put({ kv: e.kv, key: await importDataKey(raw), createdAt: Date.now() });
      await saveEnvelope(e);
      got.push(e.kv); raw.fill(0); progress = true;
    }
  }
  return got;
}

/**
 * Đổi khóa: DEK mới (kv+1) + recovery key MỚI. Các thiết bị khác tự theo kịp qua chain.
 * Sau đó cần mã hóa lại toàn bộ dữ liệu (SyncEngine.reencryptAll) và, khi mọi thiết bị đã cập nhật, finalize để xóa envelope cũ.
 */
export async function rotateKeys(): Promise<{ recoveryKey: string; newVersion: number; envelopes: StoredEnvelope[] }> {
  const latest = await getLatestKey();
  if (!latest) throw new CryptoError('Chưa có khóa để đổi', 'missing-key');
  const kv = latest.kv + 1;
  const dek = await generateDataKeyBytes();
  const rk = await generateRecoveryKey();
  const recovery: StoredEnvelope = { kv, kind: 'recovery', envelope: await wrapDataKey(dek, kv, rk.raw) };
  const sealed = await seal(latest.key, latest.kv, `chain|${kv}`, dek);
  const chain: StoredEnvelope = { kv, kind: 'chain', envelope: { ...sealed, from: latest.kv } as Sealed };
  await db.keyring.put({ kv, key: await importDataKey(dek), createdAt: Date.now() });
  await saveEnvelope(recovery); await saveEnvelope(chain);
  dek.fill(0); rk.raw.fill(0);
  return { recoveryKey: rk.display, newVersion: kv, envelopes: [recovery, chain] };
}

/** Sau khi mọi thiết bị đã có khóa mới: bỏ envelope/chain cũ cục bộ để khóa khôi phục cũ không còn mở được dữ liệu mới. */
export async function pruneOldEnvelopes(keepFrom: number): Promise<void> {
  const old = await db.envelopes.where('kv').below(keepFrom).primaryKeys();
  await db.envelopes.bulkDelete(old);
  await db.envelopes.delete(`${keepFrom}:chain`);
}

export async function clearKeys(): Promise<void> {
  await db.keyring.clear(); await db.envelopes.clear();
}

export { toB64, fromB64 };
