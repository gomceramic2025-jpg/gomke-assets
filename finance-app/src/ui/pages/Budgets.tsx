import { useMemo, useState } from 'react';
import * as repo from '../../db/repo';
import type { Ledger } from '../hooks';
import { budgetLines, effectiveLimit, spendingAnomalies, suggestBudgets } from '../../domain/budget';
import { addMonths, formatMonthVi, monthOf } from '../../domain/dates';
import { formatVnd } from '../../domain/money';
import { Banner, Empty, Money, MoneyInput, Progress, useAction } from '../components/common';

export function Budgets({ L }: { L: Ledger }) {
  const [month, setMonth] = useState(monthOf(L.today));
  const [edit, setEdit] = useState<Record<string, number | null>>({});
  const { run } = useAction();
  const expCats = L.categories.filter((c) => c.kind === 'expense' && !c.archived);
  const lines = useMemo(() => budgetLines(L.categories, L.budgets, L.transactions, month, L.today), [L, month]);
  const anomalies = useMemo(() => spendingAnomalies(L.transactions, month), [L.transactions, month]);
  const sug = useMemo(() => suggestBudgets(L.transactions, addMonths(month, -1), L.categories), [L, month]);
  const name = (id: string) => L.categories.find((c) => c.id === id)?.name ?? '';

  const save = (categoryId: string, value: number | null, source: 'user' | 'ai-approved' = 'user') => run(async () => {
    if (value === null) throw new Error('Nhập hạn mức hợp lệ');
    const existing = L.budgets.find((b) => b.categoryId === categoryId && b.effectiveFrom === month);
    if (existing) await repo.update('budgets', existing.id, { monthlyLimit: value, source });
    else await repo.create('budgets', { categoryId, monthlyLimit: value, effectiveFrom: month, source });
    setEdit((e) => { const n = { ...e }; delete n[categoryId]; return n; });
  }, 'Đã lưu ngân sách');

  return <>
    <div className="topbar"><h1 className="grow">Ngân sách</h1><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 160 }} aria-label="Tháng" /></div>
    <p className="muted">Hạn mức mỗi danh mục áp dụng từ tháng bạn đặt trở đi (đổi hạn mức không làm thay đổi các tháng trước).</p>

    {anomalies.length > 0 && <Banner kind="warn"><strong>Chi tăng bất thường {formatMonthVi(month)}:</strong> {anomalies.map((a) => `${name(a.categoryId)} (gấp ${a.ratio} lần mức điển hình)`).join('; ')}.</Banner>}

    <div className="card table-wrap"><table><thead><tr><th>Danh mục</th><th className="right">Hạn mức/tháng</th><th className="right">Đã chi</th><th className="right">Còn lại</th><th style={{ minWidth: 120 }}>Đã dùng</th><th className="right">Dự kiến cuối tháng</th></tr></thead><tbody>
      {expCats.map((c) => {
        const l = lines.find((x) => x.categoryId === c.id); const cur = effectiveLimit(L.budgets, c.id, month);
        return <tr key={c.id}><td>{c.name}</td>
          <td className="right" style={{ minWidth: 200 }}><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            <div style={{ width: 130 }}><MoneyInput value={c.id in edit ? edit[c.id]! : cur} onChange={(v) => setEdit((e) => ({ ...e, [c.id]: v }))} /></div>
            <button className="btn small primary" disabled={!(c.id in edit) || edit[c.id] === null} onClick={() => void save(c.id, edit[c.id]!)} aria-label={`Lưu ngân sách ${c.name}`}>Lưu</button></div></td>
          <td className="right">{l ? <Money v={l.spent} /> : '—'}</td><td className={`right ${l && l.remaining < 0 ? 'neg' : ''}`}>{l ? <Money v={l.remaining} /> : '—'}</td>
          <td>{l ? <><Progress pct={l.usedPct} tone={l.status === 'over' ? 'over' : l.status === 'warning' ? 'warn' : undefined} /><span className="small">{l.usedPct}% {l.status === 'over' && <span className="badge bad">Vượt</span>}{l.status === 'warning' && <span className="badge warn">Sắp vượt</span>}</span></> : <span className="small muted">Chưa đặt</span>}</td>
          <td className="right small">{l ? (l.projected !== null ? <><Money v={l.projected} /><div className="muted">{l.projectionNote}</div></> : <span className="muted">{l.projectionNote}</span>) : '—'}</td></tr>;
      })}
    </tbody></table></div>

    <section className="card" style={{ marginTop: 12 }}><h2>Gợi ý ngân sách từ lịch sử</h2>
      {!sug.enough ? <Empty title="Chưa đủ dữ liệu để đề xuất đáng tin cậy">Cần ít nhất 2 trong 3 tháng gần nhất có chi phí (hiện có {sug.monthsUsed}). Ứng dụng không tự bịa lịch sử thu chi.</Empty> : <>
        <p className="small muted">Đề xuất = trung vị chi {sug.monthsUsed} tháng trước {formatMonthVi(month)}, làm tròn lên 50.000 ₫. Đây là thống kê theo quy tắc. Ngân sách của bạn chỉ thay đổi khi bạn bấm “Áp dụng”.</p>
        <div className="table-wrap"><table><tbody>{sug.items.map((s) => { const cur = effectiveLimit(L.budgets, s.categoryId, month); return <tr key={s.categoryId}><td>{name(s.categoryId)}</td><td className="right"><Money v={s.suggested} /></td><td className="small muted">{cur === null ? 'chưa đặt' : `đang ${formatVnd(cur)}`}</td><td className="right"><button className="btn small" disabled={cur === s.suggested} onClick={() => void save(s.categoryId, s.suggested)}>Áp dụng</button></td></tr>; })}</tbody></table></div></>}
    </section>
  </>;
}
