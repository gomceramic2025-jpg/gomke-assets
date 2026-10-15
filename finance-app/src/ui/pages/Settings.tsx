import { useState } from 'react';
import * as repo from '../../db/repo';
import { loadSampleData, removeSampleData } from '../../db/seed';
import type { Category } from '../../domain/schemas';
import type { Ledger } from '../hooks';
import { reserveTarget } from '../../domain/goals';
import { formatVnd } from '../../domain/money';
import { Banner, Confirm, Field, Money, MoneyInput, useAction } from '../components/common';

export function SettingsPage({ L }: { L: Ledger }) {
  const s = L.settings;
  const [name, setName] = useState(s.displayName);
  const [base, setBase] = useState<number | null>(s.baseMonthlyExpense);
  const [months, setMonths] = useState(s.reserveMonths);
  const [plan, setPlan] = useState(s.planMonths);
  const [liab, setLiab] = useState<number | null>(s.declaredLiabilities);
  const [owners, setOwners] = useState(s.ownerEmails.join(', '));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [newCat, setNewCat] = useState(''); const [newKind, setNewKind] = useState<'expense' | 'income'>('expense');
  const { run, busy } = useAction();
  const reserve = L.goals.find((g) => g.systemKey === 'reserve');
  const newTarget = reserveTarget({ baseMonthlyExpense: base ?? 0, reserveMonths: months });

  const save = () => run(async () => {
    await repo.update('settings', 'settings-main', { displayName: name, baseMonthlyExpense: base ?? 0, reserveMonths: months, planMonths: plan, declaredLiabilities: liab, ownerEmails: owners.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) });
  }, 'Đã lưu cài đặt');

  return <>
    <h1>Cài đặt</h1>
    <section className="card" style={{ marginBottom: 12 }}><h2>Thông tin và giả định</h2>
      <p className="small muted">Các số dưới đây là giả định ban đầu do bạn cung cấp, không phải số liệu đã xác minh. Đơn vị tiền tệ: VND. Múi giờ: Asia/Ho_Chi_Minh.</p>
      <div className="grid g2">
        <Field label="Tên hiển thị"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Chi phí sinh hoạt cơ sở / tháng (VND)"><MoneyInput value={base} onChange={setBase} /></Field>
        <Field label="Số tháng quỹ dự phòng"><input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(Number(e.target.value))} /></Field>
        <Field label="Số tháng của kế hoạch tiết kiệm"><input type="number" min={1} max={120} value={plan} onChange={(e) => setPlan(Number(e.target.value))} /></Field>
        <Field label="Tổng nghĩa vụ tài chính (tùy chọn)" hint="Để trống = chưa khai báo (không có nghĩa là bạn không có nợ). Phiên bản này không quản lý từng khoản nợ."><MoneyInput value={liab} onChange={setLiab} /></Field>
        <Field label="Email chủ sở hữu được phép (hiển thị/ghi chú)" hint="Quyền thật do bảng allowed_owners ở máy chủ quyết định."><input value={owners} onChange={(e) => setOwners(e.target.value)} /></Field>
      </div>
      <p className="small">Quỹ dự phòng mục tiêu: <Money v={newTarget} /> ({months} tháng × {formatVnd(base ?? 0)})</p>
      <div className="row"><button className="btn primary" disabled={busy || base === null} onClick={() => void save()}>Lưu</button>
        {reserve && reserve.targetAmount !== newTarget && <button className="btn" disabled={busy} onClick={() => void run(async () => { await save(); await repo.update('goals', reserve.id, { targetAmount: newTarget }); }, 'Đã cập nhật mục tiêu quỹ dự phòng')}>Lưu và đặt mục tiêu quỹ dự phòng = {formatVnd(newTarget)}</button>}</div>
      <p className="small muted">Chính sách ghi nhận thu nhập: chỉ ghi khi bạn thực sự nhận tiền. Doanh thu/tiền của Gốm Kể không tự động thành thu nhập hay tài sản cá nhân.</p>
    </section>

    <section className="card" style={{ marginBottom: 12 }}><h2>Danh mục</h2>
      <div className="grid g2">{(['income', 'expense'] as const).map((k) => <div key={k}><h3>{k === 'income' ? 'Thu nhập' : 'Chi phí'}</h3>
        {L.categories.filter((c) => c.kind === k).map((c) => <CatRow key={c.id} c={c} />)}</div>)}</div>
      <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void run(async () => { await repo.create('categories', { name: newCat, kind: newKind, order: L.categories.length } as never); setNewCat(''); }, 'Đã thêm danh mục'); }}>
        <div className="grow"><input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Tên danh mục mới" aria-label="Tên danh mục mới" required /></div>
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as 'income' | 'expense')} style={{ width: 130 }} aria-label="Loại danh mục"><option value="expense">Chi phí</option><option value="income">Thu nhập</option></select><button className="btn">Thêm</button></form>
    </section>

    <section className="card" style={{ marginBottom: 12 }}><h2>Dữ liệu mẫu</h2>
      <p className="small muted">Dữ liệu mẫu có nhãn “Mẫu”, nằm trong các tài khoản mẫu riêng, <strong>không bao giờ đồng bộ</strong> và xóa riêng được mà không đụng dữ liệu thật. Số liệu tổng quan/báo cáo sẽ trộn cả dữ liệu mẫu khi nó đang tồn tại.</p>
      {L.hasSample ? <button className="btn danger" disabled={busy} onClick={() => setConfirmRemove(true)}>Xóa toàn bộ dữ liệu mẫu</button> : <button className="btn" disabled={busy} onClick={() => void run(async () => { const r = await loadSampleData(); return r; }, 'Đã nạp dữ liệu mẫu')}>Nạp dữ liệu mẫu để thử</button>}
    </section>

    <section className="card"><h2>AI tài chính (tùy chọn)</h2>
      <label className="row"><input type="checkbox" checked={s.aiEnabled} onChange={(e) => void run(() => repo.update('settings', 'settings-main', { aiEnabled: e.target.checked }))} /> Cho phép gửi dữ liệu <em>tổng hợp</em> tới dịch vụ AI khi tôi chủ động hỏi</label>
      <p className="small muted">Tắt mặc định. Khi tắt, ứng dụng vẫn đầy đủ chức năng và chỉ dùng phân tích thống kê theo quy tắc chạy trên máy. AI không bao giờ tự tạo/sửa/xóa dữ liệu.</p></section>

    {confirmRemove && <Confirm title="Xóa dữ liệu mẫu?" danger confirmLabel="Xóa dữ liệu mẫu" onCancel={() => setConfirmRemove(false)} onConfirm={() => { setConfirmRemove(false); void run(async () => removeSampleData(), 'Đã xóa dữ liệu mẫu'); }}><Banner kind="info">Chỉ các bản ghi có nhãn “Mẫu” bị xóa. Dữ liệu thật không bị ảnh hưởng.</Banner></Confirm>}
  </>;
}

function CatRow({ c }: { c: Category }) {
  const [edit, setEdit] = useState(false); const [v, setV] = useState(c.name); const { run } = useAction();
  return <div className="row" style={{ marginBottom: 4 }}>
    {edit ? <><div className="grow"><input value={v} onChange={(e) => setV(e.target.value)} aria-label="Tên danh mục" /></div><button className="btn small primary" onClick={() => void run(async () => { await repo.update('categories', c.id, { name: v }); setEdit(false); })}>Lưu</button></> :
      <><span className="grow" style={{ opacity: c.archived ? 0.5 : 1 }}>{c.name}{c.archived && ' (đã ẩn)'}</span><button className="btn small" onClick={() => setEdit(true)}>Đổi tên</button><button className="btn small" onClick={() => void run(() => repo.update('categories', c.id, { archived: !c.archived }))}>{c.archived ? 'Hiện' : 'Ẩn'}</button></>}
  </div>;
}
