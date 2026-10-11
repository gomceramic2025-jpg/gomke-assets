/**
 * Phân tích THỐNG KÊ THEO QUY TẮC (không phải AI tạo sinh). Chạy hoàn toàn trên máy, không gửi dữ liệu đi đâu.
 * Mỗi nhận định đều kèm bằng chứng (số liệu) và không đưa kết luận khi dữ liệu không đủ.
 */
import type { Account, Budget, Category, Goal, Contribution, Settings } from '../domain/schemas';
import { categoryTotals, monthlySeries, monthsWithData, median, netWorth, totalMoney, type TxLike } from '../domain/calc';
import { budgetLines, spendingAnomalies } from '../domain/budget';
import { addMonths, monthEnd, monthOf, monthStart, type IsoDate } from '../domain/dates';
import { allocatedByGoal, projectGoals, savingsCapacity, reserveTarget, unallocatedMoney } from '../domain/goals';
import { formatVnd } from '../domain/money';

export interface Insight { id: string; severity: 'info' | 'good' | 'warning' | 'risk'; title: string; detail: string; evidence?: string }

export interface AnalysisInput {
  today: IsoDate; accounts: Account[]; txs: TxLike[]; categories: Category[]; budgets: Budget[]; goals: Goal[]; contribs: Contribution[]; settings: Settings;
}

export function analyzeRules(i: AnalysisInput): { enoughData: boolean; monthsOfData: number; insights: Insight[] } {
  const cur = monthOf(i.today);
  const have = monthsWithData(i.txs);
  const insights: Insight[] = [];
  const name = (id: string | null) => i.categories.find((c) => c.id === id)?.name ?? 'Chưa phân loại';
  if (have.length === 0) return { enoughData: false, monthsOfData: 0, insights: [{ id: 'nodata', severity: 'info', title: 'Chưa có dữ liệu thu chi', detail: 'Hãy thêm vài giao dịch (hoặc nạp dữ liệu mẫu để thử) rồi quay lại.' }] };

  const thisMonth = monthlySeries(i.txs, [cur])[0]!;
  const prev = monthlySeries(i.txs, [addMonths(cur, -1)])[0]!;
  if (have.includes(addMonths(cur, -1)) && prev.expense > 0) {
    const ch = Math.round(((thisMonth.expense - prev.expense) / prev.expense) * 100);
    if (Number(i.today.slice(8, 10)) >= 15 && thisMonth.expense > prev.expense) insights.push({ id: 'exp-over-prev', severity: 'warning', title: 'Chi tháng này đã vượt cả tháng trước', detail: `Mới đến ngày ${Number(i.today.slice(8, 10))} mà tổng chi đã ${ch}% so với cả tháng trước.`, evidence: `${formatVnd(thisMonth.expense)} so với ${formatVnd(prev.expense)}` });
  }
  for (const a of spendingAnomalies(i.txs, cur).slice(0, 3)) {
    insights.push({ id: `anom-${a.categoryId}`, severity: 'warning', title: `Chi "${name(a.categoryId)}" tăng bất thường`, detail: `Gấp ${a.ratio} lần mức điển hình của 3 tháng trước.`, evidence: `${formatVnd(a.current)} so với mức điển hình ${formatVnd(a.typical)}` });
  }
  for (const l of budgetLines(i.categories, i.budgets, i.txs, cur, i.today)) {
    if (l.status === 'over') insights.push({ id: `bud-over-${l.categoryId}`, severity: 'risk', title: `Đã vượt ngân sách "${l.name}"`, detail: `Đã chi ${l.usedPct}% hạn mức tháng.`, evidence: `${formatVnd(l.spent)} / ${formatVnd(l.limit)}` });
    else if (l.status === 'warning') insights.push({ id: `bud-warn-${l.categoryId}`, severity: 'warning', title: `Sắp chạm ngân sách "${l.name}"`, detail: l.projected !== null ? `Nếu giữ nhịp chi hiện tại, cuối tháng khoảng ${formatVnd(l.projected)} (${l.projectionNote}).` : `Đã dùng ${l.usedPct}%.`, evidence: `${formatVnd(l.spent)} / ${formatVnd(l.limit)}` });
  }
  const cap = savingsCapacity(i.txs, i.today);
  if (cap.enough) {
    const nets = monthlySeries(i.txs, have.filter((m) => m < cur).slice(-6)).map((p) => p.net);
    const incomes = monthlySeries(i.txs, have.filter((m) => m < cur).slice(-6)).map((p) => p.income);
    const med = median(incomes);
    const spread = Math.max(...incomes) - Math.min(...incomes);
    if (med > 0 && spread / med > 0.5) insights.push({ id: 'income-volatile', severity: 'info', title: 'Thu nhập biến động mạnh', detail: 'Chênh lệch giữa tháng cao nhất và thấp nhất vượt 50% mức trung vị. Nên đặt khoản tiết kiệm theo tỷ lệ thay vì số cố định, hoặc ưu tiên quỹ dự phòng.', evidence: `Trung vị ${formatVnd(med)}, biên độ ${formatVnd(spread)}` });
    if (nets.filter((n) => n < 0).length >= 2) insights.push({ id: 'neg-months', severity: 'risk', title: 'Có nhiều tháng chi nhiều hơn thu', detail: `${nets.filter((n) => n < 0).length}/${nets.length} tháng gần đây âm. Xem lại các danh mục chi lớn nhất.` });
    const goalsLive = i.goals.filter((g) => !g.deletedAt);
    const alloc = allocatedByGoal(i.contribs);
    const base = projectGoals(goalsLive, alloc, cap.perScenario.base, i.today, 36, 'base', cap.assumptions);
    for (const g of base.goals) if (g.risk === 'at-risk' || g.risk === 'beyond-horizon') insights.push({ id: `goal-${g.goalId}`, severity: 'warning', title: `Mục tiêu "${g.name}" có nguy cơ chậm`, detail: `Theo kịch bản cơ sở (khả năng tiết kiệm ${formatVnd(cap.perScenario.base)}/tháng) ${g.completionMonth ? `dự kiến hoàn thành ${g.completionMonth}, sau hạn` : 'chưa hoàn thành trong 36 tháng'}. Đây là ước tính theo giả định, không phải cam kết.`, evidence: `Thiếu tại hạn: ${formatVnd(g.shortfallAtDeadline)}` });
  } else {
    insights.push({ id: 'cap-notenough', severity: 'info', title: 'Chưa đủ dữ liệu để dự báo tiết kiệm', detail: `Cần ít nhất 3 tháng thu chi đã kết thúc; hiện có ${cap.monthsUsed}. Phần dự báo/kịch bản sẽ hiện khi đủ dữ liệu.` });
  }
  const money = totalMoney(i.accounts, i.txs, i.today);
  const reserve = i.goals.find((g) => g.systemKey === 'reserve' && !g.deletedAt);
  const reserveNow = reserve ? allocatedByGoal(i.contribs).get(reserve.id) ?? 0 : 0;
  const target = reserveTarget(i.settings);
  if (reserveNow < target) insights.push({ id: 'reserve', severity: 'info', title: 'Quỹ dự phòng chưa đủ mục tiêu', detail: `Mục tiêu ${i.settings.reserveMonths} tháng chi phí cơ sở = ${formatVnd(target)}. Đã phân bổ ${formatVnd(reserveNow)}.`, evidence: `${Math.round((reserveNow / Math.max(1, target)) * 100)}%` });
  else insights.push({ id: 'reserve-ok', severity: 'good', title: 'Quỹ dự phòng đã đạt mục tiêu', detail: `Đã phân bổ ${formatVnd(reserveNow)} / ${formatVnd(target)}.` });
  if (unallocatedMoney(money, i.contribs) < 0) insights.push({ id: 'overalloc', severity: 'risk', title: 'Phân bổ mục tiêu vượt số tiền đang có', detail: 'Tổng tiền đã gán cho các mục tiêu lớn hơn số dư tài khoản. Kiểm tra lại khoản đóng góp hoặc số dư.' });
  const nw = netWorth(i.accounts, i.txs, [], i.settings, i.today);
  if (!nw.liabilitiesDeclared) insights.push({ id: 'liab', severity: 'info', title: 'Tài sản ròng chưa tính nghĩa vụ tài chính', detail: 'Bạn chưa khai báo tổng nghĩa vụ trong Cài đặt nên giá trị ròng có thể cao hơn thực tế nếu bạn có khoản phải trả.' });
  const top = categoryTotals(i.txs, monthStart(addMonths(cur, -1)), monthEnd(addMonths(cur, -1)))[0];
  if (top) insights.push({ id: 'top-cat', severity: 'info', title: `Danh mục chi lớn nhất tháng trước: ${name(top.categoryId)}`, detail: `Chiếm ${prev.expense ? Math.round((top.total / prev.expense) * 100) : 0}% tổng chi.`, evidence: formatVnd(top.total) });
  return { enoughData: have.length >= 3, monthsOfData: have.length, insights };
}
