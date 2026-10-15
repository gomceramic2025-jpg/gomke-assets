import { describe, it, expect } from 'vitest';
import { parseVndAmount, sumVnd, assertVnd, MAX_VND } from '../src/domain/money';
import { isValidIsoDate, parseDateLoose, addMonths, daysBetween, todayIso, monthRange } from '../src/domain/dates';
import { accountBalance, accountBalances, cashflowReport, categoryTotals, monthlySeries, netWorth, periodSummary, type TxLike } from '../src/domain/calc';
import { budgetLines, effectiveLimit, spendingAnomalies, suggestBudgets } from '../src/domain/budget';
import { allocatedByGoal, checkContribution, planFeasibility, projectGoals, reserveTarget, savingsCapacity, unallocatedMoney, cashForecast } from '../src/domain/goals';
import { findDuplicates } from '../src/domain/duplicates';
import { transactionSchema, accountSchema, type Account, type Asset, type Budget, type Category, type Contribution, type Goal } from '../src/domain/schemas';

const T = (p: Partial<TxLike> & Pick<TxLike, 'type' | 'amount' | 'date' | 'accountId'>): TxLike => ({
  refund: false, toAccountId: null, categoryId: 'c1', status: 'confirmed', deletedAt: null, purged: false, ...p,
});
const A = (id: string, opening = 0, openingDate = '2026-01-01'): Account => ({
  id, name: id, type: 'bank', openingBalance: opening, openingDate, last4: '', archived: false, order: 0,
  rev: 1, createdAt: 0, updatedAt: 0, deletedAt: null, purged: false, isSample: false,
});

describe('tiền VND', () => {
  it.each([
    ['1.000.000', 1000000], ['1,000,000', 1000000], ['1.000.000,00', 1000000], ['1,000,000.00', 1000000],
    ['1.000', 1000], ['500', 500], ['  2.500.000 ₫ ', 2500000], ['-500.000', -500000], ['(500.000)', -500000], ['1000000', 1000000], ['12 345 678', 12345678],
  ])('đọc "%s"', (input, expected) => {
    const r = parseVndAmount(input);
    if (expected === null) expect(r.ok).toBe(false); else expect(r).toEqual({ ok: true, value: expected });
  });
  it('không nhầm 1.000.000 thành 1.000 và ngược lại', () => {
    expect(parseVndAmount('1.000.000')).toEqual({ ok: true, value: 1_000_000 });
    expect(parseVndAmount('1.000')).toEqual({ ok: true, value: 1_000 });
  });
  it('từ chối số lẻ, chữ, rỗng, quá lớn, mơ hồ', () => {
    for (const bad of ['1,5', '12.5', 'abc', '', '   ', '1.00.000', '1,000.000,00', 'NaN', '9999999999999999999']) expect(parseVndAmount(bad).ok, bad).toBe(false);
    expect(parseVndAmount(1.5).ok).toBe(false);
    expect(parseVndAmount(Infinity).ok).toBe(false);
    expect(parseVndAmount(undefined).ok).toBe(false);
  });
  it('kiểm tra giới hạn an toàn', () => {
    expect(() => assertVnd(1.5)).toThrow();
    expect(() => assertVnd(MAX_VND + 1)).toThrow();
    expect(() => sumVnd([MAX_VND, MAX_VND])).toThrow();
    expect(sumVnd([1, 2, 3])).toBe(6);
  });
});

describe('ngày tháng', () => {
  it('kiểm tra lịch thật', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('01/02/2026')).toBe(false);
  });
  it('đọc dd/mm/yyyy theo kiểu Việt Nam, không đoán bừa', () => {
    expect(parseDateLoose('05/03/2026')).toBe('2026-03-05');
    expect(parseDateLoose('5-3-2026')).toBe('2026-03-05');
    expect(parseDateLoose('2026-03-05 10:20:00')).toBe('2026-03-05');
    expect(parseDateLoose('31/02/2026')).toBeNull();
    expect(parseDateLoose('hôm qua')).toBeNull();
    expect(parseDateLoose(new Date(Date.UTC(2026, 2, 5)))).toBe('2026-03-05');
    expect(parseDateLoose(46086)).toBe('2026-03-05');
  });
  it('cộng tháng, đếm ngày, múi giờ Việt Nam', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    // 18:00 UTC 31/12 = 01:00 ngày 1/1 giờ VN
    expect(todayIso(Date.UTC(2026, 11, 31, 18, 0))).toBe('2027-01-01');
    expect(monthRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('thu chi và số dư', () => {
  const accounts = [A('bank', 1_000_000), A('cash', 200_000)];
  const txs: TxLike[] = [
    T({ type: 'income', amount: 10_000_000, date: '2026-03-05', accountId: 'bank' }),
    T({ type: 'expense', amount: 3_000_000, date: '2026-03-10', accountId: 'bank' }),
    T({ type: 'transfer', amount: 2_000_000, date: '2026-03-11', accountId: 'bank', toAccountId: 'cash', categoryId: null }),
    T({ type: 'expense', amount: 500_000, date: '2026-03-12', accountId: 'cash' }),
    T({ type: 'expense', amount: 100_000, refund: true, date: '2026-03-13', accountId: 'cash' }),
    T({ type: 'adjustment', amount: -50_000, date: '2026-03-14', accountId: 'cash', categoryId: null }),
    T({ type: 'income', amount: 999, date: '2026-03-15', accountId: 'bank', status: 'pending' }),
    T({ type: 'income', amount: 777, date: '2026-03-15', accountId: 'bank', deletedAt: 5 }),
    T({ type: 'income', amount: 888, date: '2026-03-15', accountId: 'bank', purged: true }),
  ];
  it('cộng thu nhập, chi phí, chênh lệch chính xác; hoàn tiền trừ vào chi phí', () => {
    const s = periodSummary(txs, '2026-03-01', '2026-03-31');
    expect(s.income).toBe(10_000_000);
    expect(s.expense).toBe(3_000_000 + 500_000 - 100_000);
    expect(s.net).toBe(10_000_000 - 3_400_000);
  });
  it('chuyển tiền nội bộ và điều chỉnh không thành thu nhập hoặc chi phí', () => {
    const s = periodSummary(txs, '2026-03-01', '2026-03-31');
    expect(s.transferVolume).toBe(2_000_000);
    expect(s.adjustmentNet).toBe(-50_000);
    const tr = periodSummary([txs[2]!], '2026-03-01', '2026-03-31');
    expect(tr.income).toBe(0); expect(tr.expense).toBe(0);
  });
  it('không đếm giao dịch chờ xác nhận, đã xóa, đã xóa vĩnh viễn', () => {
    expect(periodSummary(txs, '2026-03-15', '2026-03-15').income).toBe(0);
  });
  it('số dư từng tài khoản và tổng', () => {
    const b = accountBalances(accounts, txs, '2026-03-31');
    expect(b.get('bank')).toBe(1_000_000 + 10_000_000 - 3_000_000 - 2_000_000);
    expect(b.get('cash')).toBe(200_000 + 2_000_000 - 500_000 + 100_000 - 50_000);
    expect(accountBalance(accounts[0]!, txs, '2026-03-04')).toBe(1_000_000);
    // tổng: chuyển tiền nội bộ triệt tiêu
    expect([...b.values()].reduce((s, v) => s + v, 0)).toBe(1_200_000 + 10_000_000 - 3_000_000 - 500_000 + 100_000 - 50_000);
  });
  it('báo cáo dòng tiền: đầu kỳ + vào − ra ± điều chỉnh = cuối kỳ, khớp số dư', () => {
    const cf = cashflowReport(accounts, txs, '2026-03-01', '2026-03-31');
    expect(cf.opening).toBe(1_200_000);
    expect(cf.inflow).toBe(10_000_000);
    expect(cf.refunds).toBe(100_000);
    expect(cf.outflow).toBe(3_500_000);
    expect(cf.transfersNet).toBe(0);
    expect(cf.adjustments).toBe(-50_000);
    const bal = [...accountBalances(accounts, txs, '2026-03-31').values()].reduce((s, v) => s + v, 0);
    expect(cf.closing).toBe(bal);
    // kỳ sau: số dư đầu = số dư cuối kỳ trước
    expect(cashflowReport(accounts, txs, '2026-04-01', '2026-04-30').opening).toBe(cf.closing);
  });
  it('tài khoản mở giữa kỳ được tính riêng và vẫn khớp số dư', () => {
    const acc = [...accounts, A('new', 700_000, '2026-03-20')];
    const cf = cashflowReport(acc, txs, '2026-03-01', '2026-03-31');
    expect(cf.newAccountsOpening).toBe(700_000);
    expect(cf.closing).toBe([...accountBalances(acc, txs, '2026-03-31').values()].reduce((s, v) => s + v, 0));
  });
  it('chuỗi theo tháng và tổng theo danh mục', () => {
    const s = monthlySeries(txs, ['2026-02', '2026-03']);
    expect(s[0]).toMatchObject({ income: 0, expense: 0 });
    expect(s[1]).toMatchObject({ income: 10_000_000, expense: 3_400_000, net: 6_600_000 });
    expect(categoryTotals(txs, '2026-03-01', '2026-03-31')[0]).toEqual({ categoryId: 'c1', total: 3_400_000 });
  });
  it('tài khoản không nhận giao dịch trước ngày mở số dư', () => {
    const acc = [A('x', 100, '2026-03-10')];
    const b = accountBalances(acc, [T({ type: 'income', amount: 50, date: '2026-03-01', accountId: 'x' })], '2026-03-31');
    expect(b.get('x')).toBe(100);
  });
});

describe('tài sản ròng', () => {
  const asset = (p: Partial<Asset>): Asset => ({ id: 'a1', name: 'x', type: 'gold', liquidity: 'semi', valuationDate: '2026-03-01', currentValue: 8_000_000, purchaseValue: null, note: '', rev: 1, createdAt: 0, updatedAt: 0, deletedAt: null, purged: false, isSample: false, ...p });
  const accounts = [A('bank', 5_000_000)];
  it('tách thanh khoản / khó chuyển thành tiền; không cộng xe nhà vào tiền chi tiêu', () => {
    const nw = netWorth(accounts, [], [asset({}), asset({ id: 'a2', type: 'vehicle', liquidity: 'illiquid', currentValue: 30_000_000 })], { declaredLiabilities: null }, '2026-03-31');
    expect(nw.ledgerMoney).toBe(5_000_000);
    expect(nw.semiLiquid).toBe(8_000_000);
    expect(nw.illiquid).toBe(30_000_000);
    expect(nw.totalAssets).toBe(43_000_000);
    expect(nw.spendable).toBe(5_000_000);
    expect(nw.netWorth).toBe(43_000_000);
    expect(nw.liabilitiesDeclared).toBe(false);
  });
  it('trừ nghĩa vụ đã khai báo; bỏ qua tài sản đã xóa', () => {
    const nw = netWorth(accounts, [], [asset({}), asset({ id: 'a3', currentValue: 1_000_000, deletedAt: 1 })], { declaredLiabilities: 3_000_000 }, '2026-03-31');
    expect(nw.liabilitiesDeclared).toBe(true);
    expect(nw.netWorth).toBe(5_000_000 + 8_000_000 - 3_000_000);
  });
});

describe('ngân sách', () => {
  const cat = (id: string, name: string): Category => ({ id, name, kind: 'expense', order: 0, archived: false, systemKey: '', rev: 1, createdAt: 0, updatedAt: 0, deletedAt: null, purged: false, isSample: false });
  const bud = (categoryId: string, monthlyLimit: number, effectiveFrom: string, updatedAt = 0): Budget => ({ id: categoryId + effectiveFrom, categoryId, monthlyLimit, effectiveFrom, source: 'user', rev: 1, createdAt: 0, updatedAt, deletedAt: null, purged: false, isSample: false });
  it('hạn mức hiệu lực theo tháng', () => {
    const b = [bud('c1', 1_000_000, '2026-01'), bud('c1', 2_000_000, '2026-04')];
    expect(effectiveLimit(b, 'c1', '2026-03')).toBe(1_000_000);
    expect(effectiveLimit(b, 'c1', '2026-05')).toBe(2_000_000);
    expect(effectiveLimit(b, 'c1', '2025-12')).toBeNull();
  });
  it('đã dùng, còn lại, dự kiến cuối tháng, cảnh báo', () => {
    const txs = [T({ type: 'expense', amount: 600_000, date: '2026-03-03', accountId: 'a' }), T({ type: 'expense', amount: 600_000, date: '2026-03-09', accountId: 'a' })];
    const [l] = budgetLines([cat('c1', 'Sinh hoạt')], [bud('c1', 2_000_000, '2026-01')], txs, '2026-03', '2026-03-10');
    expect(l).toMatchObject({ spent: 1_200_000, remaining: 800_000, usedPct: 60 });
    expect(l!.projected).toBe(Math.round((1_200_000 / 10) * 31));
    expect(l!.status).toBe('warning'); // dự kiến 3,72tr > 2tr
  });
  it('đầu tháng chưa đủ dữ liệu để dự kiến; vượt ngân sách báo over', () => {
    const txs = [T({ type: 'expense', amount: 3_000_000, date: '2026-03-02', accountId: 'a' })];
    const [l] = budgetLines([cat('c1', 'x')], [bud('c1', 2_000_000, '2026-01')], txs, '2026-03', '2026-03-03');
    expect(l!.projected).toBeNull();
    expect(l!.status).toBe('over');
  });
  it('tăng chi bất thường chỉ báo khi đủ lịch sử', () => {
    const mk = (m: string, amt: number) => T({ type: 'expense', amount: amt, date: `${m}-10`, accountId: 'a' });
    expect(spendingAnomalies([mk('2026-02', 500_000), mk('2026-03', 2_000_000)], '2026-03')).toEqual([]);
    const a = spendingAnomalies([mk('2026-01', 500_000), mk('2026-02', 600_000), mk('2026-03', 2_000_000)], '2026-03');
    expect(a).toHaveLength(1); expect(a[0]!.ratio).toBeGreaterThan(3);
  });
  it('đề xuất ngân sách: không đủ dữ liệu thì nói rõ, không bịa', () => {
    const r = suggestBudgets([T({ type: 'expense', amount: 1_000_000, date: '2026-03-10', accountId: 'a' })], '2026-03', [cat('c1', 'x')]);
    expect(r.enough).toBe(false); expect(r.items).toEqual([]);
    const r2 = suggestBudgets([T({ type: 'expense', amount: 1_020_000, date: '2026-03-10', accountId: 'a' }), T({ type: 'expense', amount: 1_000_000, date: '2026-02-10', accountId: 'a' })], '2026-03', [cat('c1', 'x')]);
    expect(r2.enough).toBe(true); expect(r2.items[0]!.suggested % 50_000).toBe(0);
  });
});

describe('mục tiêu tiết kiệm', () => {
  const goal = (id: string, priority: number, target: number, planned: number, deadline = '2027-12', status: Goal['status'] = 'active'): Goal => ({
    id, name: id, targetAmount: target, deadline, priority, plannedMonthly: planned, status, note: '', systemKey: '', rev: 1, createdAt: priority, updatedAt: 0, deletedAt: null, purged: false, isSample: false });
  const contrib = (id: string, goalId: string, amount: number, sourceTxId: string | null = null): Contribution => ({ id, goalId, amount, date: '2026-03-01', sourceTxId, note: '', rev: 1, createdAt: 0, updatedAt: 0, deletedAt: null, purged: false, isSample: false });
  it('quỹ dự phòng = chi phí cơ sở × số tháng', () => {
    expect(reserveTarget({ baseMonthlyExpense: 5_000_000, reserveMonths: 3 })).toBe(15_000_000);
    expect(reserveTarget({ baseMonthlyExpense: 6_000_000, reserveMonths: 6 })).toBe(36_000_000);
  });
  it('một đồng chỉ phân bổ cho một mục tiêu; không phân bổ vượt số tiền đang có', () => {
    const existing = [contrib('c1', 'g1', 4_000_000)];
    expect(unallocatedMoney(5_000_000, existing)).toBe(1_000_000);
    expect(checkContribution({ goalId: 'g2', amount: 1_000_000, sourceTxId: null }, existing, 5_000_000).ok).toBe(true);
    const bad = checkContribution({ goalId: 'g2', amount: 1_000_001, sourceTxId: null }, existing, 5_000_000);
    expect(bad.ok).toBe(false);
    // sửa chính khoản đó không bị tính hai lần
    expect(checkContribution({ id: 'c1', goalId: 'g1', amount: 5_000_000, sourceTxId: null }, existing, 5_000_000).ok).toBe(true);
  });
  it('một giao dịch nguồn chỉ gán cho một khoản đóng góp; không rút quá số đang có', () => {
    const existing = [contrib('c1', 'g1', 1_000_000, 'tx1')];
    expect(checkContribution({ goalId: 'g2', amount: 500_000, sourceTxId: 'tx1' }, existing, 9e9).ok).toBe(false);
    expect(checkContribution({ goalId: 'g2', amount: 500_000, sourceTxId: 'tx2' }, existing, 9e9, 400_000).ok).toBe(false);
    expect(checkContribution({ goalId: 'g1', amount: -2_000_000, sourceTxId: null }, existing, 9e9).ok).toBe(false);
    expect(allocatedByGoal([contrib('a', 'g1', 3), contrib('b', 'g1', -1), { ...contrib('c', 'g1', 100), deletedAt: 1 }]).get('g1')).toBe(2);
  });
  const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02'];
  const hist = (nets: number[]) => nets.flatMap((n, i) => [T({ type: 'income', amount: Math.max(n, 0) + 5_000_000, date: `${months[i]}-05`, accountId: 'a' }), T({ type: 'expense', amount: 5_000_000 - Math.min(n, 0), date: `${months[i]}-10`, accountId: 'a' })]);
  it('thiếu dữ liệu → nói chưa đủ, không dự báo', () => {
    const cap = savingsCapacity(hist([1_000_000, 2_000_000]), '2026-03-15');
    expect(cap.enough).toBe(false);
    expect(cashForecast(hist([1_000_000]), '2026-03-15', 5_000_000, 6).enough).toBe(false);
  });
  it('3 kịch bản: thận trọng ≤ cơ sở ≤ tích cực, khả năng tiết kiệm không âm', () => {
    const cap = savingsCapacity(hist([-1_000_000, 500_000, 1_000_000, 2_000_000, 3_000_000]), '2026-03-15');
    expect(cap.enough).toBe(true);
    expect(cap.perScenario.conservative).toBeLessThanOrEqual(cap.perScenario.base);
    expect(cap.perScenario.base).toBeLessThanOrEqual(cap.perScenario.optimistic);
    expect(cap.perScenario.base).toBe(1_000_000);
    expect(cap.netPerScenario.conservative).toBe(500_000);
    const neg = savingsCapacity(hist([-1_000_000, -2_000_000, -500_000]), '2026-03-15');
    expect(neg.perScenario.optimistic).toBe(0);
    expect(cap.assumptions.length).toBeGreaterThan(0);
  });
  it('mô phỏng theo thứ tự ưu tiên; mục tiêu ưu tiên cao hoàn thành trước', () => {
    const goals = [goal('reserve', 1, 3_000_000, 1_000_000, '2026-08'), goal('car', 2, 4_000_000, 1_000_000, '2026-12')];
    const r = projectGoals(goals, new Map(), 2_000_000, '2026-03-15', 36, 'base', []);
    expect(r.goals[0]).toMatchObject({ completionMonth: '2026-06', risk: 'on-track' });
    expect(r.goals[1]!.completionMonth).toBe('2026-07'); // xe nhận 1tr/tháng đến T6 (3tr) rồi nốt 1tr ở T7
    const slow = projectGoals(goals, new Map(), 500_000, '2026-03-15', 36, 'conservative', []);
    expect(slow.goals[0]!.risk).toBe('at-risk'); // 3tr / 0,5tr = 6 tháng → 2026-09 > hạn 2026-08
    expect(slow.goals[0]!.shortfallAtDeadline).toBe(3_000_000 - 500_000 * 5);
    const none = projectGoals(goals, new Map(), 0, '2026-03-15', 36, 'conservative', []);
    expect(none.goals.every((g) => g.completionMonth === null && g.risk === 'beyond-horizon')).toBe(true);
  });
  it('mục tiêu chưa đặt số tiền hoặc tạm dừng không bị mô phỏng; không hứa chắc chắn', () => {
    const r = projectGoals([goal('x', 1, 0, 0), goal('y', 2, 1_000_000, 1_000_000, '2027-01', 'paused')], new Map(), 5_000_000, '2026-03-15', 12, 'base', []);
    expect(r.goals[0]!.risk).toBe('no-target');
    expect(r.goals[1]!.risk).toBe('paused');
  });
  it('kế hoạch vượt khả năng thì cảnh báo thiếu hụt', () => {
    const cap = savingsCapacity(hist([500_000, 1_000_000, 1_500_000]), '2026-03-15');
    const f = planFeasibility([goal('a', 1, 10_000_000, 3_000_000)], cap, 100);
    expect(f.warnings.some((w) => w.includes('thận trọng'))).toBe(true);
    expect(planFeasibility([goal('a', 1, 10_000_000, 1)], cap, -1).warnings.some((w) => w.includes('vượt'))).toBe(true);
  });
});

describe('phát hiện giao dịch trùng', () => {
  const ex = (id: string, p: object = {}) => ({ id, date: '2026-03-05', amount: 100_000, type: 'expense' as const, accountId: 'a', description: 'Thanh toan Highlands Coffee', bankRef: '', deletedAt: null, purged: false, ...p });
  it('trùng mã giao dịch ngân hàng là mạnh', () => {
    const m = findDuplicates({ date: '2026-03-06', amount: 100_000, type: 'expense', accountId: 'a', description: 'khác', bankRef: 'FT123' }, [ex('1', { bankRef: 'FT123' })]);
    expect(m[0]!.level).toBe('strong'); expect(m[0]!.reasons[0]).toContain('FT123');
  });
  it('cùng ngày, số tiền, tài khoản, nội dung giống → nghi trùng kèm lý do; không tự xóa', () => {
    const m = findDuplicates({ date: '2026-03-05', amount: 100_000, type: 'expense', accountId: 'a', description: 'THANH TOÁN HIGHLANDS COFFEE' }, [ex('1')]);
    expect(m).toHaveLength(1); expect(m[0]!.reasons.length).toBeGreaterThanOrEqual(2);
  });
  it('khác tài khoản / khác số tiền / đã xóa → không báo', () => {
    const c = { date: '2026-03-05', amount: 100_000, type: 'expense' as const, accountId: 'a', description: 'Thanh toan Highlands Coffee' };
    expect(findDuplicates(c, [ex('1', { accountId: 'b' }), ex('2', { amount: 99_000 }), ex('3', { deletedAt: 3 })])).toEqual([]);
  });
});

describe('schema giao dịch', () => {
  const base = { id: 'abcdefgh1', rev: 1, createdAt: 1, updatedAt: 1, type: 'expense', amount: 1000, date: '2026-03-05', recordedAt: 1, categoryId: 'cat-x-1234', accountId: 'acc-1-1234' };
  it('từ chối số lẻ, ngày sai, chuyển tiền thiếu tài khoản đích hoặc trùng nguồn', () => {
    expect(transactionSchema.safeParse({ ...base, amount: 10.5 }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, amount: -5 }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, date: '2026-02-30' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, type: 'transfer', categoryId: null }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, type: 'transfer', categoryId: null, toAccountId: 'acc-1-1234' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, type: 'transfer', categoryId: null, toAccountId: 'acc-2-1234' }).success).toBe(true);
    expect(transactionSchema.safeParse({ ...base, type: 'adjustment', amount: -50, categoryId: null }).success).toBe(true);
    expect(transactionSchema.safeParse({ ...base, type: 'income', refund: true }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, categoryId: null }).success).toBe(false);
  });
  it('tài khoản: số dư phải nguyên', () => {
    expect(accountSchema.safeParse({ id: 'abcdefgh1', rev: 1, createdAt: 1, updatedAt: 1, name: 'x', type: 'bank', openingBalance: 1.2, openingDate: '2026-01-01' }).success).toBe(false);
  });
});
