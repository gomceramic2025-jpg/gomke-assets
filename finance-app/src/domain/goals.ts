import type { Contribution, Goal, Settings } from './schemas';
import { addMonths, monthOf, type IsoDate, type IsoMonth } from './dates';
import { monthlySeries, monthsWithData, percentile, median, lastNMonths, type TxLike } from './calc';
import { sumVnd } from './money';

export const reserveTarget = (s: Pick<Settings, 'baseMonthlyExpense' | 'reserveMonths'>): number => s.baseMonthlyExpense * s.reserveMonths;

const liveC = (c: Contribution) => !c.deletedAt && !c.purged;

/** Số tiền THỰC TẾ đã phân bổ cho từng mục tiêu. */
export function allocatedByGoal(contribs: readonly Contribution[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of contribs) if (liveC(c)) m.set(c.goalId, (m.get(c.goalId) ?? 0) + c.amount);
  return m;
}
export const totalAllocated = (contribs: readonly Contribution[]): number => sumVnd([...allocatedByGoal(contribs).values()]);

/** Tiền đang có nhưng chưa gán mục tiêu nào. Âm = đã phân bổ vượt số tiền đang có. */
export const unallocatedMoney = (money: number, contribs: readonly Contribution[]): number => money - totalAllocated(contribs);

export interface ContributionCheck { ok: boolean; errors: string[] }
/**
 * Kiểm tra một khoản phân bổ mới:
 *  - Không phân bổ quá số tiền chưa gán (một đồng chỉ thuộc một mục tiêu).
 *  - Rút khỏi mục tiêu không quá số đang có trong mục tiêu đó.
 *  - Một giao dịch nguồn chỉ được gán cho một khoản phân bổ.
 */
export function checkContribution(
  draft: Pick<Contribution, 'goalId' | 'amount' | 'sourceTxId'> & { id?: string },
  existing: readonly Contribution[], money: number, sourceTxAmount?: number,
): ContributionCheck {
  const errors: string[] = [];
  const others = existing.filter((c) => liveC(c) && c.id !== draft.id);
  if (draft.amount > 0) {
    const free = unallocatedMoney(money, others);
    if (draft.amount > free) errors.push(`Chỉ còn ${free < 0 ? 0 : free} đồng chưa phân bổ; không thể gán ${draft.amount} đồng`);
  } else if (draft.amount < 0) {
    const cur = allocatedByGoal(others).get(draft.goalId) ?? 0;
    if (-draft.amount > cur) errors.push('Rút nhiều hơn số tiền đang có trong mục tiêu');
  }
  if (draft.sourceTxId) {
    if (others.some((c) => c.sourceTxId === draft.sourceTxId)) errors.push('Giao dịch này đã được gán cho một khoản đóng góp khác');
    if (sourceTxAmount !== undefined && draft.amount > sourceTxAmount) errors.push('Khoản đóng góp lớn hơn giao dịch nguồn');
  }
  return { ok: errors.length === 0, errors };
}

export type Scenario = 'conservative' | 'base' | 'optimistic';
export const SCENARIO_LABEL: Record<Scenario, string> = { conservative: 'Thận trọng', base: 'Cơ sở', optimistic: 'Tích cực' };

export interface SavingsCapacity {
  enough: boolean; monthsUsed: number;
  perScenario: Record<Scenario, number>; // khả năng tiết kiệm/tháng (≥ 0)
  netPerScenario: Record<Scenario, number>; // thu − chi trung bình có thể âm
  assumptions: string[];
}

/** Ước lượng khả năng tiết kiệm/tháng từ thu−chi thực tế của tối đa 6 tháng đã kết thúc gần nhất. Cần ≥ 3 tháng có dữ liệu. */
export function savingsCapacity(txs: readonly TxLike[], today: IsoDate): SavingsCapacity {
  const cur = monthOf(today);
  const hist = monthsWithData(txs).filter((m) => m < cur).slice(-6);
  const series = monthlySeries(txs, hist).map((p) => p.net);
  const assumptions = [
    'Dựa trên chênh lệch thu − chi thực tế của các tháng đã kết thúc (tối đa 6 tháng gần nhất).',
    'Thận trọng = phân vị 25%, Cơ sở = trung vị, Tích cực = phân vị 75%. Khả năng tiết kiệm không âm.',
    'Giả định thu nhập và chi tiêu tương lai giống lịch sử; thu nhập thực tế có thể biến động mạnh.',
  ];
  const zero = { conservative: 0, base: 0, optimistic: 0 };
  if (hist.length < 3) return { enough: false, monthsUsed: hist.length, perScenario: zero, netPerScenario: zero, assumptions };
  const net = { conservative: percentile(series, 0.25), base: median(series), optimistic: percentile(series, 0.75) };
  return {
    enough: true, monthsUsed: hist.length, assumptions, netPerScenario: net,
    perScenario: { conservative: Math.max(0, net.conservative), base: Math.max(0, net.base), optimistic: Math.max(0, net.optimistic) },
  };
}

export interface GoalProjection {
  goalId: string; name: string; target: number; current: number;
  completionMonth: IsoMonth | null; // trong phạm vi kế hoạch
  amountAtDeadline: number; shortfallAtDeadline: number;
  risk: 'done' | 'on-track' | 'at-risk' | 'beyond-horizon' | 'paused' | 'no-target';
}
export interface ScenarioResult { scenario: Scenario | 'plan'; monthlyCapacity: number; goals: GoalProjection[]; assumptions: string[] }

/**
 * Mô phỏng phân bổ khả năng tiết kiệm hằng tháng cho các mục tiêu theo thứ tự ưu tiên.
 * Mỗi tháng: mục tiêu (ưu tiên cao trước) nhận min(plannedMonthly, còn thiếu, ngân sách tháng còn lại);
 * phần dư sau đó dồn tiếp cho mục tiêu ưu tiên cao nhất còn thiếu.
 * Đây là ƯỚC TÍNH theo giả định, không phải cam kết.
 */
export function projectGoals(goals: readonly Goal[], allocated: ReadonlyMap<string, number>, monthlyCapacity: number, today: IsoDate, horizonMonths: number, label: ScenarioResult['scenario'], assumptions: string[]): ScenarioResult {
  const active = goals.filter((g) => !g.deletedAt && !g.purged).sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  const state = active.map((g) => ({ g, cur: allocated.get(g.id) ?? 0, done: null as IsoMonth | null, atDeadline: null as number | null }));
  const start = monthOf(today);
  for (const s of state) {
    if (s.g.targetAmount > 0 && s.cur >= s.g.targetAmount) s.done = start;
    if (s.g.deadline <= start) s.atDeadline = s.cur;
  }
  for (let i = 1; i <= horizonMonths; i++) {
    const m = addMonths(start, i);
    let budget = monthlyCapacity;
    const live = state.filter((s) => s.g.status === 'active' && s.g.targetAmount > 0 && s.cur < s.g.targetAmount);
    for (const s of live) {
      const give = Math.min(s.g.plannedMonthly, s.g.targetAmount - s.cur, budget);
      s.cur += give; budget -= give;
    }
    for (const s of live) {
      if (budget <= 0) break;
      const give = Math.min(s.g.targetAmount - s.cur, budget);
      s.cur += give; budget -= give;
    }
    for (const s of state) {
      if (s.done === null && s.g.targetAmount > 0 && s.cur >= s.g.targetAmount) s.done = m;
      if (s.atDeadline === null && s.g.deadline === m) s.atDeadline = s.cur;
    }
  }
  const goalsOut: GoalProjection[] = state.map((s) => {
    const amountAtDeadline = s.atDeadline ?? s.cur;
    const shortfall = Math.max(0, s.g.targetAmount - amountAtDeadline);
    let risk: GoalProjection['risk'];
    if (s.g.targetAmount === 0) risk = 'no-target';
    else if ((allocated.get(s.g.id) ?? 0) >= s.g.targetAmount || s.g.status === 'done') risk = 'done';
    else if (s.g.status === 'paused') risk = 'paused';
    else if (s.done && s.done <= s.g.deadline) risk = 'on-track';
    else if (s.done) risk = 'at-risk';
    else risk = 'beyond-horizon';
    return { goalId: s.g.id, name: s.g.name, target: s.g.targetAmount, current: allocated.get(s.g.id) ?? 0, completionMonth: s.done, amountAtDeadline, shortfallAtDeadline: shortfall, risk };
  });
  return { scenario: label, monthlyCapacity, goals: goalsOut, assumptions };
}

export interface PlanFeasibility { plannedTotal: number; warnings: string[] }
/** Kiểm tra tổng kế hoạch đóng góp hằng tháng so với dòng tiền thực tế và số dư. */
export function planFeasibility(goals: readonly Goal[], cap: SavingsCapacity, unallocated: number): PlanFeasibility {
  const plannedTotal = sumVnd(goals.filter((g) => !g.deletedAt && !g.purged && g.status === 'active').map((g) => g.plannedMonthly));
  const warnings: string[] = [];
  if (!cap.enough) warnings.push(`Chưa đủ dữ liệu thu chi (${cap.monthsUsed}/3 tháng) để kiểm tra kế hoạch bằng dòng tiền thực tế.`);
  else {
    if (plannedTotal > cap.perScenario.conservative) warnings.push(`Kế hoạch ${plannedTotal.toLocaleString('vi-VN')} ₫/tháng cao hơn khả năng tiết kiệm ở kịch bản thận trọng (${cap.perScenario.conservative.toLocaleString('vi-VN')} ₫). Thiếu hụt có thể xảy ra ở tháng thu nhập thấp.`);
    if (plannedTotal > cap.perScenario.base) warnings.push(`Kế hoạch cao hơn khả năng tiết kiệm ở kịch bản cơ sở (${cap.perScenario.base.toLocaleString('vi-VN')} ₫).`);
  }
  if (unallocated < 0) warnings.push('Tổng tiền đã phân bổ cho mục tiêu vượt số tiền đang có trong tài khoản.');
  return { plannedTotal, warnings };
}

export interface CashForecast { enough: boolean; assumptions: string[]; points: Array<{ month: IsoMonth; conservative: number; base: number; optimistic: number }> }
/** Dự báo số dư tiền trong N tháng tới theo 3 kịch bản (net thu−chi có thể âm). */
export function cashForecast(txs: readonly TxLike[], today: IsoDate, currentMoney: number, months: number): CashForecast {
  const cap = savingsCapacity(txs, today);
  const assumptions = [...cap.assumptions, 'Dự báo số dư = số dư hiện tại + cộng dồn chênh lệch thu−chi theo kịch bản; không gồm các khoản chi lớn bất thường chưa biết.'];
  if (!cap.enough) return { enough: false, assumptions, points: [] };
  const start = monthOf(today);
  const points = Array.from({ length: months }, (_, i) => ({
    month: addMonths(start, i + 1),
    conservative: currentMoney + cap.netPerScenario.conservative * (i + 1),
    base: currentMoney + cap.netPerScenario.base * (i + 1),
    optimistic: currentMoney + cap.netPerScenario.optimistic * (i + 1),
  }));
  return { enough: true, assumptions, points };
}

export { lastNMonths };
