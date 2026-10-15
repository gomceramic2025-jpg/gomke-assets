/** Tiền VND luôn là số nguyên (đồng). Không dùng số thực. */
export const MAX_VND = 9_000_000_000_000_000; // < Number.MAX_SAFE_INTEGER (~9.007e15)

export function assertVnd(n: unknown, label = 'Số tiền'): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
    throw new Error(`${label} phải là số nguyên đồng`);
  }
  if (Math.abs(n) > MAX_VND) throw new Error(`${label} vượt giới hạn cho phép`);
  return n;
}

/** Cộng có kiểm tra tràn số an toàn. */
export function sumVnd(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total) || Math.abs(total) > MAX_VND) {
      throw new Error('Tổng tiền vượt giới hạn an toàn');
    }
  }
  return total;
}

export type ParsedAmount = { ok: true; value: number } | { ok: false; error: string };

/**
 * Đọc số tiền theo định dạng Việt Nam / quốc tế.
 *  "1.000.000" → 1000000   "1,000,000" → 1000000   "1.000.000,00" → 1000000
 *  "1.000" → 1000 (đúng 3 chữ số sau dấu phân cách đơn = hàng nghìn, vì VND không có phần lẻ)
 *  "(500.000)" hoặc "-500.000" → âm.   "1,5" → lỗi (không phải số nguyên đồng).
 */
export function parseVndAmount(input: unknown): ParsedAmount {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, error: 'Số không hợp lệ' };
    if (!Number.isInteger(input)) return { ok: false, error: 'Số tiền không phải số nguyên đồng' };
    if (!Number.isSafeInteger(input) || Math.abs(input) > MAX_VND) return { ok: false, error: 'Số tiền vượt giới hạn' };
    return { ok: true, value: input };
  }
  if (typeof input !== 'string') return { ok: false, error: 'Thiếu số tiền' };
  let s = input.trim().replace(/[\s\u00a0₫đĐ]|vnd|vnđ/gi, '');
  if (!s) return { ok: false, error: 'Thiếu số tiền' };
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-') || s.startsWith('−')) { neg = !neg; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return { ok: false, error: `Không đọc được số tiền "${input}"` };

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart: string;
  let fracPart = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const decIdx = Math.max(lastDot, lastComma);
    const decChar = s[decIdx]!;
    const thouChar = decChar === '.' ? ',' : '.';
    if (s.slice(0, decIdx).includes(decChar)) return { ok: false, error: `Định dạng số mơ hồ "${input}"` };
    intPart = s.slice(0, decIdx).split(thouChar).join('');
    fracPart = s.slice(decIdx + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const ch = lastDot >= 0 ? '.' : ',';
    const parts = s.split(ch);
    const last = parts[parts.length - 1]!;
    const multiple = parts.length > 2;
    if (multiple || last.length === 3) {
      // dấu phân cách hàng nghìn — mọi nhóm sau nhóm đầu phải đúng 3 chữ số
      if (parts.slice(1).some((p) => p.length !== 3)) return { ok: false, error: `Định dạng số mơ hồ "${input}"` };
      intPart = parts.join('');
    } else {
      intPart = parts[0]!;
      fracPart = last;
    }
  } else {
    intPart = s;
  }
  if (intPart === '') intPart = '0';
  if (!/^[0-9]+$/.test(intPart) || (fracPart && !/^[0-9]+$/.test(fracPart))) {
    return { ok: false, error: `Không đọc được số tiền "${input}"` };
  }
  if (fracPart && /[1-9]/.test(fracPart)) return { ok: false, error: `"${input}" không phải số nguyên đồng` };
  const value = Number(intPart);
  if (!Number.isSafeInteger(value) || value > MAX_VND) return { ok: false, error: 'Số tiền vượt giới hạn' };
  return { ok: true, value: neg ? -value : value };
}

const fmt = new Intl.NumberFormat('vi-VN');
export function formatVnd(n: number, withUnit = true): string {
  return fmt.format(n) + (withUnit ? ' ₫' : '');
}
/** Rút gọn cho biểu đồ: 1,2 tr / 3,5 tỷ */
export function formatVndShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}k`;
  return String(n);
}
