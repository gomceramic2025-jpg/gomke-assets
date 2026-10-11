/**
 * Lớp mã hóa — chỉ dùng Web Crypto API của trình duyệt/Node (thư viện chuẩn đã được kiểm chứng).
 * KHÔNG tự cài thuật toán.
 *
 *  - Dữ liệu: AES-256-GCM, nonce 96-bit ngẫu nhiên (CSPRNG) cho MỖI thông điệp; API không cho phép truyền nonce từ ngoài.
 *    Với khóa dữ liệu 256-bit và nonce ngẫu nhiên 96-bit, giới hạn an toàn khuyến nghị (NIST SP 800-38D) là ≤ 2^32 thông điệp / khóa;
 *    ứng dụng cá nhân ở mức vài chục nghìn thông điệp, thấp hơn nhiều bậc. Đổi khóa (rotateKey) khi cần.
 *  - AAD (dữ liệu xác thực kèm) gắn ciphertext với collection|id|keyVersion → không thể hoán đổi bản ghi trên máy chủ mà không bị phát hiện.
 *  - Khóa dữ liệu (DEK) ngẫu nhiên 256-bit sinh trên thiết bị. Không bao giờ gửi dạng rõ lên máy chủ.
 *  - Khóa khôi phục (recovery key) 256-bit ngẫu nhiên → HKDF-SHA256 → KEK → AES-GCM bọc DEK ("envelope").
 *    Envelope (đã mã hóa) có thể lưu trên máy chủ/bản sao lưu; recovery key thì không bao giờ rời khỏi người dùng.
 */

export class CryptoError extends Error {
  constructor(message: string, readonly code: 'bad-key' | 'tampered' | 'format' | 'missing-key') {
    super(message);
    this.name = 'CryptoError';
  }
}

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Trình duyệt không hỗ trợ Web Crypto (cần HTTPS hoặc localhost)');
  return s;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
export function randomId(): string {
  // 128-bit ngẫu nhiên, dạng hex — đủ cho ID bản ghi (idempotent vì ID sinh một lần khi tạo)
  return Array.from(randomBytes(16), (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  const h = new Uint8Array(await subtle().digest('SHA-256', buf));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- Khóa dữ liệu ----------
/** Sinh DEK ngẫu nhiên. extractable=true chỉ để bọc vào envelope; sau đó import lại dạng không xuất được. */
export async function generateDataKeyBytes(): Promise<Uint8Array<ArrayBuffer>> {
  return randomBytes(32);
}
export async function importDataKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (raw.length !== 32) throw new CryptoError('Khóa dữ liệu phải dài 256 bit', 'format');
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ---------- Mã hóa bản ghi ----------
export interface Sealed { v: 1; kv: number; n: string; c: string }

const aadFor = (context: string, kv: number) => enc.encode(`gomke-fin/v1|${context}|kv${kv}`);

export async function seal(key: CryptoKey, keyVersion: number, context: string, plaintext: string | Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const nonce = randomBytes(12);
  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aadFor(context, keyVersion), tagLength: 128 }, key, data));
  return { v: 1, kv: keyVersion, n: toB64(nonce), c: toB64(ct) };
}

export async function open(key: CryptoKey, context: string, sealed: Sealed): Promise<Uint8Array<ArrayBuffer>> {
  if (!sealed || sealed.v !== 1 || typeof sealed.n !== 'string' || typeof sealed.c !== 'string') throw new CryptoError('Định dạng dữ liệu mã hóa không hợp lệ', 'format');
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.n), additionalData: aadFor(context, sealed.kv), tagLength: 128 }, key, fromB64(sealed.c));
    return new Uint8Array(pt);
  } catch {
    // Sai khóa hoặc bị sửa đổi: AES-GCM không phân biệt được hai trường hợp → báo chung, không lộ thông tin
    throw new CryptoError('Không giải mã được: sai khóa hoặc dữ liệu đã bị sửa đổi', 'tampered');
  }
}

export async function sealJson(key: CryptoKey, keyVersion: number, context: string, value: unknown): Promise<string> {
  return JSON.stringify(await seal(key, keyVersion, context, JSON.stringify(value)));
}
export async function openJson<T = unknown>(key: CryptoKey, context: string, payload: string): Promise<T> {
  let sealed: Sealed;
  try { sealed = JSON.parse(payload) as Sealed; } catch { throw new CryptoError('Định dạng dữ liệu mã hóa không hợp lệ', 'format'); }
  return JSON.parse(dec.decode(await open(key, context, sealed))) as T;
}
export function sealedKeyVersion(payload: string): number {
  try { const s = JSON.parse(payload) as Sealed; return typeof s.kv === 'number' ? s.kv : -1; } catch { return -1; }
}

// ---------- Khóa khôi phục ----------
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
function toBase32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function fromBase32(s: string): Uint8Array {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new CryptoError('Khóa khôi phục chứa ký tự không hợp lệ', 'format');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}

/** Dạng hiển thị: 52 ký tự khóa + 4 ký tự kiểm tra, nhóm 4 ký tự: XXXX-XXXX-... */
export async function formatRecoveryKey(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  if (raw.length !== 32) throw new CryptoError('Khóa khôi phục phải dài 256 bit', 'format');
  const body = toBase32(raw); // 52 ký tự
  const check = (await sha256Hex(raw)).slice(0, 5);
  const checkChars = toBase32(Uint8Array.from([parseInt(check.slice(0, 2), 16), parseInt(check.slice(2, 4), 16)])).slice(0, 4);
  const all = body + checkChars;
  return all.match(/.{1,4}/g)!.join('-');
}
export async function generateRecoveryKey(): Promise<{ raw: Uint8Array<ArrayBuffer>; display: string }> {
  const raw = randomBytes(32);
  return { raw, display: await formatRecoveryKey(raw) };
}
export async function parseRecoveryKey(input: string): Promise<Uint8Array<ArrayBuffer>> {
  const norm = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (norm.length !== 56) throw new CryptoError('Khóa khôi phục phải có 56 ký tự (không tính dấu gạch)', 'format');
  const body = norm.slice(0, 52);
  const raw = new Uint8Array(fromBase32(body).slice(0, 32));
  const expected = (await formatRecoveryKey(raw)).replace(/-/g, '');
  if (expected !== norm) throw new CryptoError('Khóa khôi phục nhập sai (không khớp mã kiểm tra) — kiểm tra lại từng ký tự', 'format');
  return raw;
}

// ---------- Envelope: bọc DEK bằng khóa khôi phục ----------
export interface Envelope { v: 1; kv: number; salt: string; n: string; c: string }

async function kekFrom(recoveryRaw: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', recoveryRaw, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('gomke-fin/kek/v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function wrapDataKey(dekRaw: Uint8Array<ArrayBuffer>, keyVersion: number, recoveryRaw: Uint8Array<ArrayBuffer>): Promise<Envelope> {
  const salt = randomBytes(16);
  const kek = await kekFrom(recoveryRaw, salt);
  const s = await seal(kek, keyVersion, 'envelope', dekRaw);
  return { v: 1, kv: keyVersion, salt: toB64(salt), n: s.n, c: s.c };
}

export async function unwrapDataKey(env: Envelope, recoveryRaw: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const kek = await kekFrom(recoveryRaw, fromB64(env.salt));
  try {
    return await open(kek, 'envelope', { v: 1, kv: env.kv, n: env.n, c: env.c });
  } catch {
    throw new CryptoError('Khóa khôi phục không đúng hoặc envelope bị hỏng', 'bad-key');
  }
}
