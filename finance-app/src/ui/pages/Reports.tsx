import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Ledger } from '../hooks';
import { accountBalances, cashflowReport, categoryTotals, monthlySeries, netWorth, periodSummary, totalMoney } from '../../domain/calc';
import { budgetLines } from '../../domain/budget';
import { allocatedByGoal } from '../../domain/goals';
import { formatMonthVi, monthEnd, monthOf, monthRange, monthStart, type IsoMonth } from '../../domain/dates';
import { formatVnd, formatVndShort } from '../../domain/money';
import { cashflowTable, downloadBlob, monthsTable, toCsv, toXlsx, transactionsTable } from '../../io/exporter';
import { Empty, Money, Progress, useAction } from '../components/common';

export function Reports({ L }: { L: Ledger }) {
  const [tab, setTab] = useState<'month' | 'year' | 'cash'>('month');
  const [month, setMonth] = useState<IsoMonth>(monthOf(L.today));
  const [year, setYear] = useState(L.today.slice(0, 4));
  const [from, setFrom] = useState(monthStart(monthOf(L.today))); const [to, setTo] = useState(L.today);
  const { run } = useAction();
  const name = (id: string | null) => L.categories.find((c) => c.id === id)?.name ?? 'Chưa phân loại';

  const m = useMemo(() => {
    const f = monthStart(month), t = monthEnd(month);
    return { sum: periodSummary(L.transactions, f, t), cats: categoryTotals(L.transactions, f, t), closing: totalMoney(L.accounts, L.transactions, t), lines: budgetLines(L.categories, L.budgets, L.transactions, month, L.today),
      big: L.transactions.filter((x) => x.type === 'expense' && !x.refund && x.date >= f && x.date <= t).sort((a, b) => b.amount - a.amount).slice(0, 5), alloc: allocatedByGoal(L.contributions) };
  }, [L, month]);
  const y = useMemo(() => {
    const months = monthRange(`${year}-01`, `${year}-12`);
    const series = monthlySeries(L.transactions, months);
    const sum = periodSummary(L.transactions, `${year}-01-01`, `${year}-12-31`);
    const nwStart = netWorth(L.accounts, L.transactions, L.assets, L.settings, `${Number(year) - 1}-12-31`), nwEnd = netWorth(L.accounts, L.transactions, L.assets, L.settings, `${year}-12-31`);
    return { series, sum, cats: categoryTotals(L.transactions, `${year}-01-01`, `${year}-12-31`).slice(0, 8), nwStart, nwEnd, rate: sum.income > 0 ? Math.round((sum.net / sum.income) * 1000) / 10 : null };
  }, [L, year]);
  const cf = useMemo(() => from <= to ? cashflowReport(L.accounts, L.transactions, from, to) : null, [L, from, to]);
  const bal = useMemo(() => accountBalances(L.accounts, L.transactions, monthEnd(month)), [L, month]);

  const exportCsv = () => downloadBlob(`giao-dich-${L.today}.csv`, toCsv(transactionsTable(L.transactions, L.accounts, L.categories)), 'text/csv;charset=utf-8');
  const exportXlsx = () => run(async () => {
    const sheets = [{ name: 'Giao dịch', rows: transactionsTable(L.transactions, L.accounts, L.categories) }, { name: `Theo tháng ${year}`, rows: monthsTable(y.series) }, ...(cf ? [{ name: 'Dòng tiền', rows: cashflowTable(cf) }] : [])];
    downloadBlob(`bao-cao-${L.today}.xlsx`, await toXlsx(sheets) as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }, 'Đã tạo tệp Excel');

  return <>
    <div className="topbar no-print"><h1 className="grow">Báo cáo</h1><button className="btn" onClick={exportCsv}>Xuất CSV</button><button className="btn" onClick={() => void exportXlsx()}>Xuất Excel</button><button className="btn" onClick={() => window.print()}>In / Lưu PDF</button></div>
    <p className="small muted no-print">PDF: bấm “In / Lưu PDF” rồi chọn “Lưu thành PDF” (trên iPhone: Chia sẻ → In → thu phóng để lưu PDF). Mọi con số được tính trực tiếp từ sổ giao dịch.{L.hasSample && ' Lưu ý: đang có dữ liệu mẫu trộn trong báo cáo.'}</p>
    <div className="tabs no-print" role="tablist">{([['month', 'Báo cáo tháng'], ['year', 'Báo cáo năm'], ['cash', 'Dòng tiền']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>

    {tab === 'month' && <>
      <div className="row no-print"><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 160 }} aria-label="Tháng" /></div>
      <h2>{formatMonthVi(month)}</h2>
      <div className="grid g4"><div className="card"><div className="small muted">Thu nhập</div><Money v={m.sum.income} /></div><div className="card"><div className="small muted">Chi phí</div><Money v={m.sum.expense} /></div><div className="card"><div className="small muted">Chênh lệch</div><Money v={m.sum.net} signed /></div><div className="card"><div className="small muted">Số dư cuối kỳ</div><Money v={m.closing} /></div></div>
      <section className="card" style={{ marginTop: 12 }}><h3>Ngân sách theo danh mục</h3>{m.lines.length === 0 ? <Empty title="Chưa đặt ngân sách cho tháng này" /> : <div className="table-wrap"><table><thead><tr><th>Danh mục</th><th className="right">Hạn mức</th><th className="right">Đã chi</th><th className="right">Còn lại</th><th>%</th></tr></thead><tbody>{m.lines.map((l) => <tr key={l.categoryId}><td>{l.name}</td><td className="right"><Money v={l.limit} /></td><td className="right"><Money v={l.spent} /></td><td className="right"><Money v={l.remaining} /></td><td style={{ minWidth: 100 }}><Progress pct={l.usedPct} tone={l.status === 'over' ? 'over' : undefined} />{l.usedPct}%</td></tr>)}</tbody></table></div>}</section>
      <div className="grid g2" style={{ marginTop: 12 }}>
        <section className="card"><h3>Chi theo danh mục</h3>{m.cats.length === 0 ? <Empty title="Không có chi phí" /> : <table><tbody>{m.cats.map((c) => <tr key={c.categoryId ?? 'x'}><td>{name(c.categoryId)}</td><td className="right"><Money v={c.total} /></td></tr>)}</tbody></table>}</section>
        <section className="card"><h3>5 khoản chi lớn nhất</h3>{m.big.length === 0 ? <Empty title="Không có" /> : <table><tbody>{m.big.map((t) => <tr key={t.id}><td>{t.date.slice(8)}/{t.date.slice(5, 7)} {t.description || name(t.categoryId)}</td><td className="right"><Money v={t.amount} /></td></tr>)}</tbody></table>}</section>
      </div>
      <section className="card" style={{ marginTop: 12 }}><h3>Tiến độ mục tiêu (tiền đã phân bổ thực tế)</h3>{L.goals.map((g) => { const c = m.alloc.get(g.id) ?? 0; return <div key={g.id} style={{ marginBottom: 6 }}><div className="row" style={{ justifyContent: 'space-between' }}><span>{g.name}</span><span className="small num">{formatVnd(c)} / {g.targetAmount ? formatVnd(g.targetAmount) : 'chưa đặt'}</span></div><Progress pct={g.targetAmount ? (c / g.targetAmount) * 100 : 0} /></div>; })}</section>
      <section className="card" style={{ marginTop: 12 }}><h3>Số dư từng tài khoản cuối kỳ</h3><table><tbody>{L.accounts.map((a) => <tr key={a.id}><td>{a.name}</td><td className="right"><Money v={bal.get(a.id) ?? 0} /></td></tr>)}</tbody></table></section>
    </>}

    {tab === 'year' && <>
      <div className="row no-print"><input type="number" min={2000} max={2200} value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 120 }} aria-label="Năm" /></div>
      <h2>Năm {year}</h2>
      <div className="grid g4"><div className="card"><div className="small muted">Tổng thu nhập</div><Money v={y.sum.income} /></div><div className="card"><div className="small muted">Tổng chi phí</div><Money v={y.sum.expense} /></div><div className="card"><div className="small muted">Tiết kiệm thực tế (thu − chi)</div><Money v={y.sum.net} signed />{y.rate !== null && <div className="small muted">{y.rate}% thu nhập</div>}</div><div className="card"><div className="small muted">Tài sản ròng đầu → cuối năm</div><span className="num small">{formatVnd(y.nwStart.netWorth)} → {formatVnd(y.nwEnd.netWorth)}</span></div></div>
      <section className="card" style={{ marginTop: 12 }}><h3>Xu hướng từng tháng</h3>{y.series.every((p) => !p.income && !p.expense) ? <Empty title="Chưa có dữ liệu năm này" /> : <div className="chart"><ResponsiveContainer><BarChart data={y.series.map((p) => ({ ...p, name: p.month.slice(5) }))}><CartesianGrid strokeDasharray="3 3" stroke="#e4d8c9" /><XAxis dataKey="name" /><YAxis tickFormatter={formatVndShort} width={56} /><Tooltip formatter={(v) => formatVnd(Number(v))} /><Legend /><Bar dataKey="income" name="Thu nhập" fill="#3f7a52" /><Bar dataKey="expense" name="Chi phí" fill="#b4492b" /></BarChart></ResponsiveContainer></div>}</section>
      <div className="grid g2" style={{ marginTop: 12 }}><section className="card"><h3>Danh mục chi lớn nhất</h3><table><tbody>{y.cats.map((c) => <tr key={c.categoryId ?? 'x'}><td>{name(c.categoryId)}</td><td className="right"><Money v={c.total} /></td></tr>)}</tbody></table></section>
        <section className="card"><h3>Mức độ hoàn thành mục tiêu</h3>{L.goals.map((g) => { const c = allocatedByGoal(L.contributions).get(g.id) ?? 0; return <div key={g.id} className="row" style={{ justifyContent: 'space-between' }}><span>{g.name}</span><span className="num">{g.targetAmount ? `${Math.round((c / g.targetAmount) * 100)}%` : '—'}</span></div>; })}</section></div>
    </>}

    {tab === 'cash' && <>
      <div className="row no-print"><label className="row">Từ <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} /></label><label className="row">Đến <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} /></label></div>
      {!cf ? <Empty title="Khoảng thời gian không hợp lệ" /> : <section className="card" style={{ marginTop: 12 }}><h2>Báo cáo dòng tiền {from} → {to}</h2><table><tbody>
        <tr><td>Số dư đầu kỳ</td><td className="right"><Money v={cf.opening} /></td></tr>
        {cf.newAccountsOpening !== 0 && <tr><td>Số dư đầu của tài khoản mở trong kỳ</td><td className="right"><Money v={cf.newAccountsOpening} /></td></tr>}
        <tr><td>Tiền vào (thu nhập)</td><td className="right"><Money v={cf.inflow} signed /></td></tr><tr><td>Hoàn tiền</td><td className="right"><Money v={cf.refunds} signed /></td></tr>
        <tr><td>Tiền ra (chi phí)</td><td className="right"><Money v={-cf.outflow} signed /></td></tr><tr><td>Chuyển khoản nội bộ (ròng)</td><td className="right"><Money v={cf.transfersNet} /></td></tr><tr><td>Điều chỉnh số dư</td><td className="right"><Money v={cf.adjustments} signed /></td></tr>
        <tr><th>Số dư cuối kỳ</th><th className="right"><Money v={cf.closing} /></th></tr></tbody></table>
        <p className="small muted">Chuyển nội bộ giữa tài khoản của bạn không phải thu hay chi nên ròng bằng 0. Điều chỉnh là chênh lệch khớp số dư, tách riêng khỏi thu/chi.</p></section>}
    </>}
  </>;
}
