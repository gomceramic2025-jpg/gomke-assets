import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as repo from '../../db/repo';
import type { Ledger } from '../hooks';
import type { Goal } from '../../domain/schemas';
import { totalMoney } from '../../domain/calc';
import { allocatedByGoal, cashForecast, planFeasibility, projectGoals, reserveTarget, SCENARIO_LABEL, savingsCapacity, totalAllocated, unallocatedMoney, type Scenario } from '../../domain/goals';
import { addMonths, monthOf } from '../../domain/dates';
import { formatVnd, formatVndShort } from '../../domain/money';
import { Banner, Confirm, Empty, Field, Modal, Money, MoneyInput, Progress, useAction } from '../components/common';

const RISK: Record<string, [string, string]> = { done: ['Đã đạt', 'good'], 'on-track': ['Kịp hạn (theo giả định)', 'good'], 'at-risk': ['Nguy cơ chậm', 'warn'], 'beyond-horizon': ['Không kịp trong kế hoạch', 'bad'], paused: ['Tạm dừng', ''], 'no-target': ['Chưa đặt số tiền', ''] };

export function Goals({ L }: { L: Ledger }) {
  const [edit, setEdit] = useState<Goal | 'new' | null>(null);
  const [contribGoal, setContribGoal] = useState<Goal | null>(null);
  const [delGoal, setDelGoal] = useState<Goal | null>(null);
  const { run } = useAction();
  const d = useMemo(() => {
    const money = totalMoney(L.accounts, L.transactions, L.today);
    const alloc = allocatedByGoal(L.contributions);
    const cap = savingsCapacity(L.transactions, L.today);
    const horizon = L.settings.planMonths;
    const plannedCap = L.goals.filter((g) => g.status === 'active').reduce((s, g) => s + g.plannedMonthly, 0);
    const scen = (['conservative', 'base', 'optimistic'] as Scenario[]).map((s) => projectGoals(L.goals, alloc, cap.perScenario[s], L.today, horizon, s, cap.assumptions));
    const plan = projectGoals(L.goals, alloc, plannedCap, L.today, horizon, 'plan', ['Giả định bạn đóng đủ khoản dự kiến hằng tháng của mọi mục tiêu đang hoạt động — chưa được kiểm chứng bằng dòng tiền thực.']);
    return { money, alloc, cap, scen, plan, allocated: totalAllocated(L.contributions), free: unallocatedMoney(money, L.contributions), feas: planFeasibility(L.goals, cap, unallocatedMoney(money, L.contributions)), forecast: cashForecast(L.transactions, L.today, money, 12) };
  }, [L]);
  const reserveTgt = reserveTarget(L.settings);
  const [sel, setSel] = useState<Scenario | 'plan'>('base');
  const result = sel === 'plan' ? d.plan : d.scen.find((s) => s.scenario === sel)!;

  return <>
    <div className="topbar"><h1 className="grow">Mục tiêu tiết kiệm · {L.settings.planMonths} tháng</h1><button className="btn primary" onClick={() => setEdit('new')}>+ Mục tiêu</button></div>
    <Banner kind="info"><strong>Thực tế ≠ dự kiến.</strong> “Đã phân bổ” là tiền thật bạn gán cho mục tiêu từ số dư đang có (không tạo tiền mới, một đồng chỉ thuộc một mục tiêu). “Dự kiến” chỉ là ước tính theo giả định và không đảm bảo bạn đạt mục tiêu.</Banner>
    <div className="grid g3">
      <div className="card stat"><div className="label">Tiền đang có (các tài khoản)</div><div className="value num">{formatVnd(d.money)}</div></div>
      <div className="card stat"><div className="label">Đã phân bổ cho mục tiêu</div><div className="value num">{formatVnd(d.allocated)}</div></div>
      <div className="card stat"><div className="label">Chưa phân bổ</div><div className={`value num ${d.free < 0 ? 'neg' : ''}`}>{formatVnd(d.free)}</div>{d.free < 0 && <div className="sub neg">Phân bổ vượt số tiền đang có!</div>}</div>
    </div>
    <p className="small muted">Quỹ dự phòng mặc định = {L.settings.reserveMonths} tháng × {formatVnd(L.settings.baseMonthlyExpense)} = <strong>{formatVnd(reserveTgt)}</strong> (đổi trong Cài đặt).</p>

    {L.goals.length === 0 ? <div className="card"><Empty title="Chưa có mục tiêu" /></div> : <div className="grid g2">{L.goals.map((g) => {
      const cur = d.alloc.get(g.id) ?? 0; const pr = result.goals.find((x) => x.goalId === g.id); const [rl, rt] = RISK[pr?.risk ?? 'paused']!;
      return <section className="card" key={g.id} aria-label={g.name}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h3>{g.priority}. {g.name}</h3>{g.status !== 'active' && <span className="badge">{g.status === 'done' ? 'Hoàn thành' : 'Tạm dừng'}</span>}</div>
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="num"><strong>{formatVnd(cur)}</strong> / {g.targetAmount ? formatVnd(g.targetAmount) : <em className="muted">chưa đặt số tiền</em>}</span><span className="small muted">Hạn {g.deadline.slice(5)}/{g.deadline.slice(0, 4)}</span></div>
        <Progress pct={g.targetAmount ? (cur / g.targetAmount) * 100 : 0} />
        <p className="small">Đóng góp dự kiến: <Money v={g.plannedMonthly} />/tháng <span className="muted">(kế hoạch)</span> · <span className={`badge ${rt}`}>{rl}</span>{pr?.completionMonth && pr.risk !== 'done' && <span className="muted"> · dự kiến xong {pr.completionMonth}</span>}</p>
        {g.note && <p className="small muted">{g.note}</p>}
        <div className="row"><button className="btn small primary" onClick={() => setContribGoal(g)}>Phân bổ tiền</button><button className="btn small" onClick={() => setEdit(g)}>Sửa</button><button className="btn small danger" onClick={() => setDelGoal(g)}>Xóa</button></div>
      </section>; })}</div>}

    <section className="card" style={{ marginTop: 12 }}><h2>Dự báo theo kịch bản</h2>
      {d.feas.warnings.map((w) => <Banner key={w} kind="warn">{w}</Banner>)}
      <div className="tabs" role="tablist">{(['conservative', 'base', 'optimistic', 'plan'] as const).map((s) => <button key={s} role="tab" aria-selected={sel === s} onClick={() => setSel(s)}>{s === 'plan' ? 'Theo kế hoạch của bạn' : SCENARIO_LABEL[s]}</button>)}</div>
      {sel !== 'plan' && !d.cap.enough ? <Empty title="Chưa đủ dữ liệu để dự báo theo kịch bản">Cần ít nhất 3 tháng thu chi đã kết thúc (hiện có {d.cap.monthsUsed}). Trong lúc chờ, tab “Theo kế hoạch của bạn” cho biết điều gì xảy ra <em>nếu</em> bạn đóng đủ khoản dự kiến.</Empty> : <>
        <p>Khả năng tiết kiệm giả định: <strong>{formatVnd(result.monthlyCapacity)}/tháng</strong>. Mục tiêu được nạp theo thứ tự ưu tiên.</p>
        <div className="table-wrap"><table><thead><tr><th>Mục tiêu</th><th className="right">Hiện có</th><th className="right">Cần đạt</th><th>Dự kiến hoàn thành</th><th className="right">Thiếu tại hạn</th><th>Đánh giá</th></tr></thead><tbody>
          {result.goals.map((g) => <tr key={g.goalId}><td>{g.name}</td><td className="right"><Money v={g.current} /></td><td className="right">{g.target ? <Money v={g.target} /> : '—'}</td><td>{g.completionMonth ?? (g.risk === 'no-target' ? '—' : `Sau ${L.settings.planMonths} tháng`)}</td><td className="right">{g.target ? <Money v={g.shortfallAtDeadline} /> : '—'}</td><td><span className={`badge ${RISK[g.risk]![1]}`}>{RISK[g.risk]![0]}</span></td></tr>)}</tbody></table></div>
        <details className="small muted"><summary>Giả định</summary><ul>{result.assumptions.map((a) => <li key={a}>{a}</li>)}<li>Kết quả là ước tính, không phải cam kết.</li></ul></details></>}
      {d.forecast.enough && <><h3 style={{ marginTop: 14 }}>Số dư tiền dự báo 12 tháng</h3><div className="chart"><ResponsiveContainer><LineChart data={d.forecast.points.map((p) => ({ ...p, name: p.month.slice(5) + '/' + p.month.slice(2, 4) }))}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4d8c9" /><XAxis dataKey="name" /><YAxis tickFormatter={formatVndShort} width={56} /><Tooltip formatter={(v) => formatVnd(Number(v))} /><Legend />
        <Line dataKey="conservative" name="Thận trọng" stroke="#b4492b" dot={false} /><Line dataKey="base" name="Cơ sở" stroke="#8a5a33" strokeWidth={2} dot={false} /><Line dataKey="optimistic" name="Tích cực" stroke="#3f7a52" dot={false} /></LineChart></ResponsiveContainer></div></>}
    </section>

    {edit && <GoalForm goal={edit === 'new' ? null : edit} count={L.goals.length} onClose={() => setEdit(null)} />}
    {contribGoal && <ContribModal L={L} goal={contribGoal} free={d.free} cur={d.alloc.get(contribGoal.id) ?? 0} onClose={() => setContribGoal(null)} />}
    {delGoal && <Confirm title="Xóa mục tiêu?" danger confirmLabel="Chuyển vào thùng rác" onCancel={() => setDelGoal(null)} onConfirm={() => { void run(() => repo.softDelete('goals', delGoal.id), 'Đã xóa mục tiêu'); setDelGoal(null); }}><p>Mục tiêu “{delGoal.name}” sẽ bị ẩn. Tiền đã phân bổ cho nó sẽ không còn được tính vào mục tiêu nào (trở về “chưa phân bổ”).</p></Confirm>}
  </>;
}

function GoalForm({ goal, count, onClose }: { goal: Goal | null; count: number; onClose: () => void }) {
  const [name, setName] = useState(goal?.name ?? ''); const [target, setTarget] = useState<number | null>(goal?.targetAmount ?? 0);
  const [deadline, setDeadline] = useState(goal?.deadline ?? addMonths(monthOf(new Date().toISOString()), 36)); const [priority, setPriority] = useState(goal?.priority ?? count + 1);
  const [planned, setPlanned] = useState<number | null>(goal?.plannedMonthly ?? 0); const [status, setStatus] = useState<Goal['status']>(goal?.status ?? 'active'); const [note, setNote] = useState(goal?.note ?? '');
  const [err, setErr] = useState(''); const { run, busy } = useAction();
  const save = async () => { try { const b = { name, targetAmount: target ?? 0, deadline, priority, plannedMonthly: planned ?? 0, status, note }; if (goal) await repo.update('goals', goal.id, b); else await repo.create('goals', b as never); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Lỗi'); } };
  return <Modal title={goal ? 'Sửa mục tiêu' : 'Thêm mục tiêu'} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); void run(save); }}>
    <Field label="Tên mục tiêu"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} /></Field>
    <div className="grid g2"><Field label="Số tiền cần đạt (0 = chưa đặt)"><MoneyInput value={target} onChange={setTarget} /></Field><Field label="Hạn (tháng)"><input type="month" value={deadline} onChange={(e) => setDeadline(e.target.value)} required /></Field>
      <Field label="Ưu tiên (1 = cao nhất)" hint="Có thể đổi để sắp xếp lại thứ tự"><input type="number" min={1} max={99} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></Field>
      <Field label="Đóng góp dự kiến/tháng (kế hoạch)"><MoneyInput value={planned} onChange={setPlanned} /></Field></div>
    <Field label="Trạng thái"><select value={status} onChange={(e) => setStatus(e.target.value as Goal['status'])}><option value="active">Đang thực hiện</option><option value="paused">Tạm dừng</option><option value="done">Hoàn thành</option></select></Field>
    <Field label="Ghi chú"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    {err && <p className="neg" role="alert">{err}</p>}<div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Hủy</button><button className="btn primary" disabled={busy}>Lưu</button></div></form></Modal>;
}

function ContribModal({ L, goal, free, cur, onClose }: { L: Ledger; goal: Goal; free: number; cur: number; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(null); const [dir, setDir] = useState<1 | -1>(1); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const { run, busy } = useAction();
  const mine = L.contributions.filter((c) => c.goalId === goal.id).sort((a, b) => b.date.localeCompare(a.date));
  const save = async () => { if (!amount) return setErr('Nhập số tiền'); try { await repo.create('contributions', { goalId: goal.id, amount: dir * amount, date: L.today, note } as never); setAmount(null); setNote(''); setErr(''); } catch (e) { setErr(e instanceof Error ? e.message : 'Lỗi'); } };
  return <Modal title={`Phân bổ tiền · ${goal.name}`} onClose={onClose} wide>
    <p>Hiện có trong mục tiêu: <strong>{formatVnd(cur)}</strong> · Chưa phân bổ: <strong className={free < 0 ? 'neg' : ''}>{formatVnd(free)}</strong></p>
    <p className="small muted">Đây là việc gán tiền ĐÃ CÓ trong tài khoản cho mục tiêu — không tạo giao dịch và không tạo tiền mới.</p>
    <form onSubmit={(e) => { e.preventDefault(); void run(save); }} className="row" style={{ alignItems: 'flex-end' }}>
      <div style={{ width: 130 }}><Field label="Chiều"><select value={dir} onChange={(e) => setDir(Number(e.target.value) as 1 | -1)}><option value={1}>Gán thêm</option><option value={-1}>Rút lại</option></select></Field></div>
      <div className="grow"><Field label="Số tiền"><MoneyInput value={amount} onChange={setAmount} /></Field></div><div className="grow"><Field label="Ghi chú"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
      <button className="btn primary" style={{ marginBottom: 10 }} disabled={busy}>Xác nhận</button></form>
    {err && <p className="neg" role="alert">{err}</p>}
    {mine.length > 0 && <div className="table-wrap"><table><thead><tr><th>Ngày</th><th className="right">Số tiền</th><th>Ghi chú</th><th /></tr></thead><tbody>{mine.map((c) => <tr key={c.id}><td>{c.date}</td><td className="right"><Money v={c.amount} signed /></td><td>{c.note}</td><td><button className="btn small danger" onClick={() => void run(() => repo.softDelete('contributions', c.id), 'Đã hủy khoản phân bổ')}>Hủy</button></td></tr>)}</tbody></table></div>}
  </Modal>;
}
