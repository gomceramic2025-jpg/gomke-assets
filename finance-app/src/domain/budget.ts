import type { Budget, Category } from './schemas';
import { categoryTotals, isCounted, median, type TxLike } from './calc';
import { addMonths, daysInMonth, monthEnd, monthOf, monthStart, type IsoDate, type IsoMonth } from './dates';

/** Hạn mức hiệu lực cho một danh mục tại tháng m: bản ghi mới nhất có effectiveFrom ≤ m. */
export function effectiveLimit(budgets: readonly Budget[], categoryId: string, month: IsoMonth): number | null {
  const cands = budgets.filter((b) => !b.deletedAt && !b.purged && b.categoryId === categoryId && b.effectiveFrom <= month)
    .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? b.updatedAt - a.updatedAt : b.effectiveFrom.localeCompare(a.effectiveFrom)));
  return cands[0]?.monthlyLimit ?? null;
}

export interface BudgetLine {
  categoryId: string; name: string; limit: number; spent: number; remaining: number; usedPct: number;
  projected: number | null;       // dự kiến cuối tháng (null nếu không đủ cơ sở)
  projectionNote: string;
  status: 'ok' | 'warning' | 'over';
}

export function budgetLines(categories: readonly Category[], budgets: readonly Budget[], txs: readonly TxLike[], month: IsoMonth, today: IsoDate): BudgetLine[] {
  const totals = new Map(categoryTotals(txs, monthStart(month), monthEnd(month), 'expense').map((c) => [c.categoryId, c.total]));
  const lines: BudgetLine[] = [];
  const dim = daysInMonth(month);
  const currentMonth = monthOf(today) === month;
  const pastMonth = month < monthOf(today);
  const elapsed = currentMonth ? Number(today.slice(8, 10)) : pastMonth ? dim : 0;
  for (const c of categories) {
    if (c.kind !== 'expense' || c.deletedAt || c.purged) continue;
    const limit = effectiveLimit(budgets, c.id, month);
    if (limit === null) continue;
    const spent = totals.get(c.id) ?? 0;
    let projected: number | null = null;
    let projectionNote: string;
    if (pastMonth) { projected = spent; projectionNote = 'Tháng đã kết thúc'; }
    else if (currentMonth) {
      if (elapsed < 5) projectionNote = 'Mới đầu tháng, chưa đủ dữ liệu để dự kiến';
      else { projected = Math.round((spent / elapsed) * dim); projectionNote = `Ngoại suy tuyến tính từ ${elapsed}/${dim} ngày`; }
    } else projectionNote = 'Tháng chưa bắt đầu';
    const usedPct = limit > 0 ? Math.round((spent / limit) * 1000) / 10 : spent > 0 ? 100 : 0;
    const status: BudgetLine['status'] = spent > limit ? 'over' : (usedPct >= 80 || (projected !== null && projected > limit)) ? 'warning' : 'ok';
    lines.push({ categoryId: c.id, name: c.name, limit, spent, remaining: limit - spent, usedPct, projected, projectionNote, status });
  }
  return lines;
}

export interface Anomaly { categoryId: string; month: IsoMonth; current: number; typical: number; ratio: number }

/** Danh mục chi tăng bất thường: tháng này > 1,5 lần trung vị của tối đa 3 tháng trước (cần ≥ 2 tháng có chi) và chênh ≥ minDiff. */
export function spendingAnomalies(txs: readonly TxLike[], month: IsoMonth, minDiff = 200_000): Anomaly[] {
  const prev = [1, 2, 3].map((i) => addMonths(month, -i));
  const cur = categoryTotals(txs, monthStart(month), monthEnd(month), 'expense');
  const prevTotals = prev.map((m) => new Map(categoryTotals(txs, monthStart(m), monthEnd(m), 'expense').map((c) => [c.categoryId, c.total])));
  const out: Anomaly[] = [];
  for (const c of cur) {
    if (!c.categoryId) continue;
    const hist = prevTotals.map((m) => m.get(c.categoryId!) ?? 0).filter((v, i) => v > 0 || prevTotals[i]!.size > 0);
    const nonZero = hist.filter((v) => v > 0);
    if (nonZero.length < 2) continue;
    const typical = median(hist);
    if (typical <= 0) continue;
    const ratio = c.total / typical;
    if (ratio >= 1.5 && c.total - typical >= minDiff) out.push({ categoryId: c.categoryId, month, current: c.total, typical, ratio: Math.round(ratio * 100) / 100 });
  }
  return out.sort((a, b) => b.current - b.typical - (a.current - a.typical));
}

/** Đề xuất ngân sách từ lịch sử: trung vị 3 tháng gần nhất làm tròn lên 50.000. Cần ≥ 2 tháng có dữ liệu chi. */
export interface BudgetSuggestion { categoryId: string; suggested: number; basisMonths: number }
export function suggestBudgets(txs: readonly TxLike[], endMonth: IsoMonth, categories: readonly Category[]): { enough: boolean; monthsUsed: number; items: BudgetSuggestion[] } {
  const months = [0, 1, 2].map((i) => addMonths(endMonth, -i));
  const withData = months.filter((m) => txs.some((t) => isCounted(t) && t.type === 'expense' && monthOf(t.date) === m));
  if (withData.length < 2) return { enough: false, monthsUsed: withData.length, items: [] };
  const per = withData.map((m) => new Map(categoryTotals(txs, monthStart(m), monthEnd(m), 'expense').map((c) => [c.categoryId, c.total])));
  const items: BudgetSuggestion[] = [];
  for (const c of categories) {
    if (c.kind !== 'expense' || c.deletedAt || c.purged) continue;
    const vals = per.map((p) => p.get(c.id) ?? 0);
    if (vals.every((v) => v === 0)) continue;
    const med = median(vals);
    items.push({ categoryId: c.id, suggested: Math.ceil(med / 50_000) * 50_000, basisMonths: withData.length });
  }
  return { enough: true, monthsUsed: withData.length, items };
}
