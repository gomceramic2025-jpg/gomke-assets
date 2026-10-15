import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Ledger } from '../hooks';
import { useSync } from '../hooks';
import { formatMonthVi, monthEnd, monthOf, monthStart, lastNMonthsFn } from './dashUtil';
import { categoryTotals, monthlySeries, netWorth, periodSummary, totalMoney } from '../../domain/calc';
import { budgetLines } from '../../domain/budget';
import { allocatedByGoal, cashForecast, reserveTarget, totalAllocated } from '../../domain/goals';
import { formatVnd, formatVndShort } from '../../domain/money';
import { Banner, Empty, Money, Progress, Stat } from '../components/common';
import { STATUS_LABEL } from '../../sync/controller';

export function Dashboard({ L, go }: { L: Ledger; go: (r: string) => void }) {
  const [month, setMonth] = useState(monthOf(L.today));
  const [range, setRange] = useState(6);
  const sync = useSync();
  const d = useMemo(() => {
    const from = monthStart(month), to = monthEnd(month);
    const sum = periodSummary(L.transactions, from, to);
    const asOf = month === monthOf(L.today) ? L.today : to;
    const money = totalMoney(L.accounts, L.transactions, asOf);
    const nw = netWorth(L.accounts, L.transactions, L.assets, L.settings, asOf);
    const lines = budgetLines(L.categories, L.budgets, L.transactions, month, L.today);
    const limit = lines.reduce((s, l) => s + l.limit, 0), spent = lines.reduce((s, l) => s + l.spent, 0);
    const series = monthlySeries(L.transactions, lastNMonthsFn(month, range));
    const cats = categoryTotals(L.transactions, from, to).filter((c) => c.total > 0).slice(0, 5);
    const alloc = allocatedByGoal(L.contributions);
    const reserve = L.goals.find((g) => g.systemKey === 'reserve');
    const forecast = cashForecast(L.transactions, L.today, totalMoney(L.accounts, L.transactions, L.today), 6);
    return { sum, money, nw, limit, spent, series, cats, alloc, reserve, forecast, allocated: totalAllocated(L.contributions), hasBudget: lines.length > 0 };
  }, [L, month, range]);
  const catName = (id: string | null) => L.categories.find((c) => c.id === id)?.name ?? 'Chưa phân loại';
  const empty = L.transactions.length === 0;
  const reserveTgt = d.reserve && d.reserve.targetAmount > 0 ? d.reserve.targetAmount : reserveTarget(L.settings);
  const reserveNow = d.reserve ? d.alloc.get(d.reserve.id) ?? 0 : 0;

  return <>
    <div className="topbar"><h1 className="grow">Tổng quan</h1>
      <label className="row small"><span>Tháng</span><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 160 }} aria-label="Chọn tháng" /></label>
      <label className="row small"><span>Biểu đồ</span><select value={range} onChange={(e) => setRange(Number(e.target.value))} style={{ width: 130 }} aria-label="Khoảng thời gian biểu đồ"><option value={3}>3 tháng</option><option value={6}>6 tháng</option><option value={12}>12 tháng</option></select></label>
    </div>
    {L.hasSample && <Banner kind="sample" actions={<button className="btn small" onClick={() => go('cai-dat')}>Xóa dữ liệu mẫu</button>}><strong>Đang có dữ liệu MẪU</strong> (có nhãn “Mẫu”). Các số liệu bên dưới đang trộn dữ liệu mẫu — hãy xóa dữ liệu mẫu trước khi nhập dữ liệu thật.</Banner>}
    {sync.conflicts > 0 && <Banner kind="warn" actions={<button className="btn small" onClick={() => go('dong-bo')}>Xử lý</button>}>Có {sync.conflicts} xung đột đồng bộ cần bạn chọn bản đúng.</Banner>}
    {sync.configured && sync.status !== 'synced' && sync.status !== 'conflict' && <p className="small muted">Đồng bộ: {STATUS_LABEL[sync.status]}{sync.pending ? ` · ${sync.pending} thay đổi chờ gửi` : ''}</p>}
    {empty && <Banner kind="info" actions={<><button className="btn small primary" onClick={() => go('giao-dich')}>Thêm giao dịch</button><button className="btn small" onClick={() => go('cai-dat')}>Nạp dữ liệu mẫu</button></>}>Chưa có giao dịch nào. Thêm giao dịch đầu tiên, nhập sao kê, hoặc nạp dữ liệu mẫu để thử.</Banner>}

    <div className="grid g4">
      <Stat label="Số dư tiền (các tài khoản)" value={formatVnd(d.money)} sub="Tiền thực có trong sổ — khác với tài sản ròng" />
      <Stat label={`Thu nhập ${formatMonthVi(month)}`} value={formatVnd(d.sum.income)} tone="pos" sub="Chỉ tính tiền thực nhận" />
      <Stat label={`Chi phí ${formatMonthVi(month)}`} value={formatVnd(d.sum.expense)} tone="neg" sub="Đã trừ hoàn tiền" />
      <Stat label="Chênh lệch thu − chi" value={formatVnd(d.sum.net)} tone={d.sum.net >= 0 ? 'pos' : 'neg'} sub={d.sum.transferVolume ? `Chuyển nội bộ ${formatVnd(d.sum.transferVolume)} không tính` : 'Chuyển nội bộ/điều chỉnh không tính'} />
      <div className="card stat"><div className="label">Ngân sách đã dùng</div>
        {d.hasBudget ? <><div className="value num">{formatVnd(d.spent)} <span className="small muted">/ {formatVnd(d.limit)}</span></div><Progress pct={d.limit ? (d.spent / d.limit) * 100 : 0} tone={d.spent > d.limit ? 'over' : d.spent > d.limit * 0.8 ? 'warn' : undefined} /></> : <div className="sub">Chưa đặt ngân sách. <a href="#/ngan-sach">Đặt ngân sách</a></div>}</div>
      <Stat label="Tổng tài sản" value={formatVnd(d.nw.totalAssets)} sub={`Thanh khoản ${formatVnd(d.nw.spendable)} · còn lại khó chuyển thành tiền`} />
      <Stat label="Tài sản ròng" value={formatVnd(d.nw.netWorth)} sub={d.nw.liabilitiesDeclared ? `Đã trừ nghĩa vụ ${formatVnd(d.nw.liabilities)}` : 'Chưa khai báo nghĩa vụ tài chính — có thể cao hơn thực tế'} />
      <div className="card stat"><div className="label">Quỹ dự phòng</div><div className="value num">{formatVnd(reserveNow)} <span className="small muted">/ {formatVnd(reserveTgt)}</span></div><Progress pct={reserveTgt ? (reserveNow / reserveTgt) * 100 : 0} /><div className="sub">Số tiền đã phân bổ thực tế · còn chưa phân bổ {formatVnd(Math.max(0, d.money - d.allocated))}</div></div>
    </div>

    <div className="grid g2" style={{ marginTop: 12 }}>
      <section className="card" aria-label="Biểu đồ thu chi theo tháng"><h2>Thu chi theo tháng</h2>
        {d.series.every((p) => !p.income && !p.expense) ? <Empty title="Chưa có dữ liệu trong khoảng này" /> :
          <div className="chart"><ResponsiveContainer><BarChart data={d.series.map((p) => ({ ...p, name: p.month.slice(5) + '/' + p.month.slice(2, 4) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4d8c9" /><XAxis dataKey="name" /><YAxis tickFormatter={formatVndShort} width={56} />
            <Tooltip formatter={(v) => formatVnd(Number(v))} /><Legend />
            <Bar dataKey="income" name="Thu nhập" fill="#3f7a52" radius={[3, 3, 0, 0]} /><Bar dataKey="expense" name="Chi phí" fill="#b4492b" radius={[3, 3, 0, 0]} />
          </BarChart></ResponsiveContainer></div>}
      </section>
      <section className="card" aria-label="Dự báo dòng tiền"><h2>Dự báo số dư 6 tháng tới</h2>
        {!d.forecast.enough ? <Empty title="Chưa đủ dữ liệu để dự báo">Cần ít nhất 3 tháng thu chi đã kết thúc. Dự báo sẽ hiện khi đủ — ứng dụng không tự bịa lịch sử.</Empty> :
          <><div className="chart"><ResponsiveContainer><LineChart data={d.forecast.points.map((p) => ({ ...p, name: p.month.slice(5) + '/' + p.month.slice(2, 4) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4d8c9" /><XAxis dataKey="name" /><YAxis tickFormatter={formatVndShort} width={56} /><Tooltip formatter={(v) => formatVnd(Number(v))} /><Legend />
            <Line dataKey="conservative" name="Thận trọng" stroke="#b4492b" dot={false} /><Line dataKey="base" name="Cơ sở" stroke="#8a5a33" strokeWidth={2} dot={false} /><Line dataKey="optimistic" name="Tích cực" stroke="#3f7a52" dot={false} />
          </LineChart></ResponsiveContainer></div><details className="small muted"><summary>Giả định của dự báo</summary><ul>{d.forecast.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></details></>}
      </section>
    </div>

    <div className="grid g2" style={{ marginTop: 12 }}>
      <section className="card"><h2>Chi lớn nhất {formatMonthVi(month)}</h2>
        {d.cats.length === 0 ? <Empty title="Chưa có chi phí trong tháng này" /> : d.cats.map((c) => <div key={c.categoryId ?? 'x'} style={{ marginBottom: 8 }}><div className="row" style={{ justifyContent: 'space-between' }}><span>{catName(c.categoryId)}</span><Money v={c.total} /></div><Progress pct={d.sum.expense ? (c.total / d.sum.expense) * 100 : 0} /></div>)}
      </section>
      <section className="card"><h2>Tiến độ mục tiêu</h2>
        {L.goals.filter((g) => g.status !== 'done').slice(0, 6).map((g) => { const cur = d.alloc.get(g.id) ?? 0; return <div key={g.id} style={{ marginBottom: 8 }}><div className="row" style={{ justifyContent: 'space-between' }}><span>{g.name}</span><span className="small muted num">{g.targetAmount ? `${formatVnd(cur)} / ${formatVnd(g.targetAmount)}` : `${formatVnd(cur)} · chưa đặt mục tiêu`}</span></div><Progress pct={g.targetAmount ? (cur / g.targetAmount) * 100 : 0} /></div>; })}
        <p className="small muted">Đây là tiền đã phân bổ thực tế, không phải dự kiến.</p>
      </section>
    </div>
  </>;
}
