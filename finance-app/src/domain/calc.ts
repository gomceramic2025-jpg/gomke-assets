/**
 * Toàn bộ phép tính tài chính nằm ở đây — hàm thuần, không đụng DB/UI, có unit test.
 *
 * Quy ước tác động lên số dư tài khoản (chỉ giao dịch đã xác nhận, chưa xóa):
 *   income      : +amount vào accountId
 *   expense     : −amount khỏi accountId (hoàn tiền refund=true: +amount)
 *   transfer    : −amount khỏi accountId, +amount vào toAccountId (không phải thu/chi)
 *   adjustment  : +amount (có dấu) vào accountId (không phải thu/chi)
 */
import type { Account, Asset, Settings, Transaction } from './schemas';
import { addDays, addMonths, monthOf, type IsoDate, type IsoMonth } from './dates';
import { sumVnd } from './money';

export type TxLike = Pick<Transaction, 'type' | 'amount' | 'refund' | 'date' | 'accountId' | 'toAccountId' | 'categoryId' | 'status' | 'deletedAt' | 'purged'>;

export function isCounted(t: Pick<Transaction, 'status' | 'deletedAt' | 'purged'>): boolean {
  return t.status === 'confirmed' && !t.deletedAt && !t.purged;
}

export function txEffects(t: TxLike): Array<{ accountId: string; delta: number }> {
  switch (t.type) {
    case 'income': return [{ accountId: t.accountId, delta: t.amount }];
    case 'expense': return [{ accountId: t.accountId, delta: t.refund ? t.amount : -t.amount }];
    case 'transfer': return t.toAccountId
      ? [{ accountId: t.accountId, delta: -t.amount }, { accountId: t.toAccountId, delta: t.amount }]
      : [];
    case 'adjustment': return [{ accountId: t.accountId, delta: t.amount }];
  }
}

/** Số dư của một tài khoản tại cuối ngày asOf (bao gồm giao dịch ngày asOf). */
export function accountBalance(account: Pick<Account, 'id' | 'openingBalance' | 'openingDate'>, txs: readonly TxLike[], asOf: IsoDate): number {
  if (account.openingDate > asOf) return 0;
  const parts: number[] = [account.openingBalance];
  for (const t of txs) {
    if (!isCounted(t) || t.date < account.openingDate || t.date > asOf) continue;
    for (const e of txEffects(t)) if (e.accountId === account.id) parts.push(e.delta);
  }
  return sumVnd(parts);
}

export function accountBalances(accounts: readonly Account[], txs: readonly TxLike[], asOf: IsoDate): Map<string, number> {
  const idx = new Map<string, { acc: Account; sum: number }>();
  for (const a of accounts) idx.set(a.id, { acc: a, sum: a.openingDate > asOf ? 0 : a.openingBalance });
  for (const t of txs) {
    if (!isCounted(t) || t.date > asOf) continue;
    for (const e of txEffects(t)) {
      const slot = idx.get(e.accountId);
      if (!slot || t.date < slot.acc.openingDate) continue;
      slot.sum += e.delta;
    }
  }
  const out = new Map<string, number>();
  for (const [k, v] of idx) out.set(k, sumVnd([v.sum]));
  return out;
}

export function totalMoney(accounts: readonly Account[], txs: readonly TxLike[], asOf: IsoDate, includeArchived = true): number {
  const b = accountBalances(accounts, txs, asOf);
  return sumVnd(accounts.filter((a) => includeArchived || !a.archived).map((a) => b.get(a.id) ?? 0));
}

export interface PeriodSummary { income: number; expense: number; net: number; transferVolume: number; adjustmentNet: number; txCount: number }

/** Thu/chi trong [from, to]. Chuyển tiền & điều chỉnh KHÔNG tính vào thu/chi. Hoàn tiền trừ vào chi phí. */
export function periodSummary(txs: readonly TxLike[], from: IsoDate, to: IsoDate): PeriodSummary {
  let income = 0, expense = 0, transferVolume = 0, adjustmentNet = 0, txCount = 0;
  for (const t of txs) {
    if (!isCounted(t) || t.date < from || t.date > to) continue;
    txCount++;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.refund ? -t.amount : t.amount;
    else if (t.type === 'transfer') transferVolume += t.amount;
    else adjustmentNet += t.amount;
  }
  return { income: sumVnd([income]), expense: sumVnd([expense]), net: sumVnd([income - expense]), transferVolume, adjustmentNet, txCount };
}

export interface MonthPoint { month: IsoMonth; income: number; expense: number; net: number }
export function monthlySeries(txs: readonly TxLike[], months: readonly IsoMonth[]): MonthPoint[] {
  const m = new Map<IsoMonth, MonthPoint>(months.map((k) => [k, { month: k, income: 0, expense: 0, net: 0 }]));
  for (const t of txs) {
    if (!isCounted(t)) continue;
    const p = m.get(monthOf(t.date));
    if (!p) continue;
    if (t.type === 'income') p.income += t.amount;
    else if (t.type === 'expense') p.expense += t.refund ? -t.amount : t.amount;
  }
  return months.map((k) => { const p = m.get(k)!; p.net = p.income - p.expense; return p; });
}

export function categoryTotals(txs: readonly TxLike[], from: IsoDate, to: IsoDate, kind: 'income' | 'expense' = 'expense'): Array<{ categoryId: string | null; total: number }> {
  const m = new Map<string | null, number>();
  for (const t of txs) {
    if (!isCounted(t) || t.type !== kind || t.date < from || t.date > to) continue;
    const signed = kind === 'expense' && t.refund ? -t.amount : t.amount;
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + signed);
  }
  return [...m.entries()].map(([categoryId, total]) => ({ categoryId, total })).sort((a, b) => b.total - a.total);
}

export interface CashflowReport {
  from: IsoDate; to: IsoDate;
  opening: number;          // số dư đầu kỳ của các tài khoản đã mở trước kỳ
  newAccountsOpening: number; // số dư đầu của tài khoản mở trong kỳ
  inflow: number;           // thu nhập (đã trừ không tính hoàn tiền)
  refunds: number;          // hoàn tiền (tiền vào)
  outflow: number;          // chi phí
  transfersNet: number;     // chuyển nội bộ — luôn 0 khi cả hai tài khoản được theo dõi
  adjustments: number;
  closing: number;
}

export function cashflowReport(accounts: readonly Account[], txs: readonly TxLike[], from: IsoDate, to: IsoDate): CashflowReport {
  const dayBefore = addDays(from, -1);
  const before = accountBalances(accounts, txs, dayBefore);
  const opening = sumVnd(accounts.filter((a) => a.openingDate < from).map((a) => before.get(a.id) ?? 0));
  const newAccountsOpening = sumVnd(accounts.filter((a) => a.openingDate >= from && a.openingDate <= to).map((a) => a.openingBalance));
  let inflow = 0, refunds = 0, outflow = 0, transfersNet = 0, adjustments = 0;
  const open = new Map(accounts.map((a) => [a.id, a.openingDate]));
  for (const t of txs) {
    if (!isCounted(t) || t.date < from || t.date > to) continue;
    const eff = txEffects(t).filter((e) => open.has(e.accountId) && t.date >= open.get(e.accountId)!);
    if (t.type === 'income') inflow += eff.reduce((s, e) => s + e.delta, 0);
    else if (t.type === 'expense') { const d = eff.reduce((s, e) => s + e.delta, 0); if (t.refund) refunds += d; else outflow += -d; }
    else if (t.type === 'transfer') transfersNet += eff.reduce((s, e) => s + e.delta, 0);
    else adjustments += eff.reduce((s, e) => s + e.delta, 0);
  }
  const closing = opening + newAccountsOpening + inflow + refunds - outflow + transfersNet + adjustments;
  return { from, to, opening, newAccountsOpening, inflow, refunds, outflow, transfersNet, adjustments, closing: sumVnd([closing]) };
}

export interface NetWorth {
  ledgerMoney: number;       // tiền trong các tài khoản theo dõi bằng sổ giao dịch
  manualLiquid: number;      // tài sản nhập tay có tính thanh khoản cao (VD tiền gửi ngoài sổ)
  semiLiquid: number;
  illiquid: number;
  totalAssets: number;
  liabilities: number;       // nghĩa vụ đã khai báo (0 nếu chưa khai báo)
  liabilitiesDeclared: boolean;
  netWorth: number;
  /** Tiền có thể dùng chi tiêu ngay: chỉ số dư sổ + tài sản thanh khoản nhập tay; KHÔNG gồm xe, nhà, v.v. */
  spendable: number;
}

export function netWorth(accounts: readonly Account[], txs: readonly TxLike[], assets: readonly Asset[], settings: Pick<Settings, 'declaredLiabilities'>, asOf: IsoDate): NetWorth {
  const ledgerMoney = totalMoney(accounts, txs, asOf);
  const live = assets.filter((a) => !a.deletedAt && !a.purged && a.valuationDate <= asOf);
  const by = (l: Asset['liquidity']) => sumVnd(live.filter((a) => a.liquidity === l).map((a) => a.currentValue));
  const manualLiquid = by('liquid'), semiLiquid = by('semi'), illiquid = by('illiquid');
  const totalAssets = ledgerMoney + manualLiquid + semiLiquid + illiquid;
  const liabilitiesDeclared = settings.declaredLiabilities !== null;
  const liabilities = settings.declaredLiabilities ?? 0;
  return { ledgerMoney, manualLiquid, semiLiquid, illiquid, totalAssets, liabilities, liabilitiesDeclared, netWorth: totalAssets - liabilities, spendable: ledgerMoney + manualLiquid };
}

/** Các tháng có dữ liệu thu/chi (đã xác nhận), tăng dần. */
export function monthsWithData(txs: readonly TxLike[]): IsoMonth[] {
  const s = new Set<IsoMonth>();
  for (const t of txs) if (isCounted(t) && (t.type === 'income' || t.type === 'expense')) s.add(monthOf(t.date));
  return [...s].sort();
}

export function lastNMonths(endMonth: IsoMonth, n: number): IsoMonth[] {
  return Array.from({ length: n }, (_, i) => addMonths(endMonth, i - n + 1));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return Math.round(s[lo]! + (s[hi]! - s[lo]!) * (idx - lo));
}
