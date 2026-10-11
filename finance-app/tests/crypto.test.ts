import { describe, it, expect } from 'vitest';
import {
  CryptoError, fromB64, generateDataKeyBytes, generateRecoveryKey, importDataKey, open, openJson, parseRecoveryKey, seal, sealJson,
  toB64, unwrapDataKey, wrapDataKey, type Sealed,
} from '../src/crypto/crypto';

const newKey = async () => importDataKey(await generateDataKeyBytes());

describe('mã hóa AES-256-GCM', () => {
  it('mã hóa rồi giải mã đúng, bản mã không chứa bản rõ', async () => {
    const k = await newKey();
    const secret = { note: 'Tiền lương tháng 9: 12.345.678', amount: 12345678 };
    const payload = await sealJson(k, 1, 'transactions|abc', secret);
    expect(payload).not.toContain('Tiền lương');
    expect(payload).not.toContain('12345678');
    expect(payload).not.toContain('12.345.678');
    expect(await openJson(k, 'transactions|abc', payload)).toEqual(secret);
  });

  it('không có khóa đúng thì không giải mã được (sai khóa thất bại an toàn)', async () => {
    const k1 = await newKey(), k2 = await newKey();
    const payload = await sealJson(k1, 1, 'x|1', { a: 1 });
    await expect(openJson(k2, 'x|1', payload)).rejects.toBeInstanceOf(CryptoError);
  });

  it('phát hiện dữ liệu bị sửa (ciphertext, nonce)', async () => {
    const k = await newKey();
    const s = await seal(k, 1, 'x|1', 'hello');
    const ct = fromB64(s.c); ct[0] = ct[0]! ^ 1;
    await expect(open(k, 'x|1', { ...s, c: toB64(ct) })).rejects.toThrow(/sai khóa hoặc dữ liệu đã bị sửa/);
    const n = fromB64(s.n); n[0] = n[0]! ^ 1;
    await expect(open(k, 'x|1', { ...s, n: toB64(n) })).rejects.toBeInstanceOf(CryptoError);
  });

  it('AAD: không thể hoán đổi bản mã sang bản ghi hay phiên bản khóa khác', async () => {
    const k = await newKey();
    const s = await seal(k, 1, 'transactions|A', 'tx A');
    await expect(open(k, 'transactions|B', s)).rejects.toBeInstanceOf(CryptoError);
    await expect(open(k, 'transactions|A', { ...s, kv: 2 })).rejects.toBeInstanceOf(CryptoError);
  });

  it('nonce không bao giờ lặp lại trong 20.000 lần mã hóa cùng khóa', async () => {
    const k = await newKey();
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i++) {
      const s = await seal(k, 1, 'c|1', 'same message');
      expect(fromB64(s.n).length).toBe(12);
      expect(seen.has(s.n)).toBe(false);
      seen.add(s.n);
    }
  });

  it('cùng bản rõ ra bản mã khác nhau', async () => {
    const k = await newKey();
    const a = await seal(k, 1, 'c|1', 'same'), b = await seal(k, 1, 'c|1', 'same');
    expect(a.c).not.toBe(b.c);
  });

  it('định dạng sai bị từ chối rõ ràng', async () => {
    const k = await newKey();
    await expect(openJson(k, 'x', 'không phải json')).rejects.toMatchObject({ code: 'format' });
    await expect(open(k, 'x', { v: 2 } as unknown as Sealed)).rejects.toMatchObject({ code: 'format' });
  });
});

describe('khóa khôi phục và envelope', () => {
  it('sinh khóa 56 ký tự, parse lại đúng, chấp nhận chữ thường/khoảng trắng', async () => {
    const { raw, display } = await generateRecoveryKey();
    expect(display.replace(/-/g, '')).toHaveLength(56);
    expect(await parseRecoveryKey(display)).toEqual(raw);
    expect(await parseRecoveryKey(' ' + display.toLowerCase().replace(/-/g, ' ') + ' ')).toEqual(raw);
  });

  it('phát hiện gõ sai ký tự nhờ mã kiểm tra', async () => {
    const { display } = await generateRecoveryKey();
    const chars = display.split('');
    const i = chars.findIndex((c) => c !== '-');
    chars[i] = chars[i] === 'A' ? 'B' : 'A';
    await expect(parseRecoveryKey(chars.join(''))).rejects.toBeInstanceOf(CryptoError);
    await expect(parseRecoveryKey('ABC')).rejects.toBeInstanceOf(CryptoError);
  });

  it('thêm thiết bị mới: envelope + recovery key mở lại đúng khóa dữ liệu', async () => {
    const dek = await generateDataKeyBytes();
    const rk = await generateRecoveryKey();
    const env = await wrapDataKey(dek, 1, rk.raw);
    expect(JSON.stringify(env)).not.toContain(toB64(dek));
    // thiết bị cũ mã hóa
    const oldKey = await importDataKey(dek);
    const payload = await sealJson(oldKey, 1, 'transactions|1', { amount: 5000 });
    // thiết bị mới: chỉ có envelope + recovery key
    const restored = await unwrapDataKey(env, await parseRecoveryKey(rk.display));
    expect(restored).toEqual(dek);
    expect(await openJson(await importDataKey(restored), 'transactions|1', payload)).toEqual({ amount: 5000 });
  });

  it('mất / sai recovery key → không mở được envelope (dữ liệu không thể khôi phục)', async () => {
    const dek = await generateDataKeyBytes();
    const rk = await generateRecoveryKey();
    const other = await generateRecoveryKey();
    const env = await wrapDataKey(dek, 1, rk.raw);
    await expect(unwrapDataKey(env, other.raw)).rejects.toMatchObject({ code: 'bad-key' });
  });

  it('envelope bị sửa bị phát hiện', async () => {
    const dek = await generateDataKeyBytes();
    const rk = await generateRecoveryKey();
    const env = await wrapDataKey(dek, 1, rk.raw);
    const c = fromB64(env.c); c[3] = c[3]! ^ 4;
    await expect(unwrapDataKey({ ...env, c: toB64(c) }, rk.raw)).rejects.toMatchObject({ code: 'bad-key' });
    await expect(unwrapDataKey({ ...env, kv: 9 }, rk.raw)).rejects.toMatchObject({ code: 'bad-key' });
  });

  it('khóa dữ liệu import không xuất được (non-extractable)', async () => {
    const k = await newKey();
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
  });
});
