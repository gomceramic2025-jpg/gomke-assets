/**
 * Quy ước ngày tháng:
 *  - Ngày giao dịch là "ngày dân sự" (civil date) theo giờ Việt Nam, lưu dạng 'YYYY-MM-DD' đã kiểm tra lịch thật.
 *    Không gắn giờ, nên không bị lệch múi giờ khi đồng bộ giữa các thiết bị.
 *  - Mốc thời gian hệ thống (createdAt, updatedAt, deletedAt) là epoch milliseconds (UTC).
 *  - Tháng: 'YYYY-MM'.
 */
export const APP_TIMEZONE = 'Asia/Ho_Chi_Minh';

export type IsoDate = string;
export type IsoMonth = string;

export function isValidIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  if (y < 1990 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidIsoMonth(s: unknown): s is IsoMonth {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Ngày hôm nay theo giờ Việt Nam. */
export function todayIso(now: number = Date.now()): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const monthOf = (d: IsoDate): IsoMonth => d.slice(0, 7);

export function monthStart(m: IsoMonth): IsoDate { return `${m}-01`; }
export function daysInMonth(m: IsoMonth): number {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mm, 0)).getUTCDate();
}
export function monthEnd(m: IsoMonth): IsoDate { return `${m}-${pad(daysInMonth(m))}`; }

export function addMonths(m: IsoMonth, n: number): IsoMonth {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const total = y * 12 + (mm - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export function monthsBetween(from: IsoMonth, to: IsoMonth): number {
  const [y1, m1] = from.split('-').map(Number) as [number, number];
  const [y2, m2] = to.split('-').map(Number) as [number, number];
  return (y2 - y1) * 12 + (m2 - m1);
}

export function monthRange(from: IsoMonth, to: IsoMonth): IsoMonth[] {
  const out: IsoMonth[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, day + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

export function formatDateVi(d: IsoDate): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}
export function formatMonthVi(m: IsoMonth): string {
  const [y, mm] = m.split('-');
  return `Tháng ${Number(mm)}/${y}`;
}

/**
 * Đọc ngày từ chuỗi do người dùng/ngân hàng cung cấp. Ưu tiên dd/mm/yyyy (Việt Nam).
 * Trả null nếu không chắc chắn (không đoán bừa).
 */
export function parseDateLoose(input: unknown): IsoDate | null {
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    // Date từ Excel đã ở UTC 00:00 của ngày dân sự
    return `${input.getUTCFullYear()}-${pad(input.getUTCMonth() + 1)}-${pad(input.getUTCDate())}`;
  }
  if (typeof input === 'number') {
    // Serial Excel (1900 date system); chỉ chấp nhận khoảng hợp lý
    if (input > 20000 && input < 80000) {
      const ms = Math.round((input - 25569) * 86400000);
      return parseDateLoose(new Date(ms));
    }
    return null;
  }
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) {
    const iso = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T].*)?$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})(?:[ T].*)?$/.exec(s);
  if (m) {
    const iso = `20${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  return null;
}
