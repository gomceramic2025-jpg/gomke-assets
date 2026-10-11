import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import * as repo from '../../db/repo';
import type { Ledger } from '../hooks';
import { useSync } from '../hooks';
import type { Transaction, TxType } from '../../domain/schemas';
import { formatDateVi } from '../../domain/dates';
import { Banner, Confirm, Empty, Field, Modal, Money, MoneyInput, useAction } from '../components/common';
import { monthOf } from '../../domain/dates';

const TYPE_LABEL: Record<TxType, string> = { income: 'Thu nhập', expense: 'Chi phí', transfer: 'Chuyển tiền', adjustment: 'Điều chỉnh' };

export function Transactions({ L }: { L: Ledger }) {
  const [tab, setTab] = useState<'list' | 'trash' | 'history'>('list');
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [month, setMonth] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [acc, setAcc] = useState('');
  const [cat, setCat] = useState('');
  const [delTarget, setDelTarget] = useState<Transaction | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<Transaction | null>(null);
  const { run } = useAction();
  const sync = useSync();
  const pendingKeys = useLiveQuery(async () => new Set((await db.outbox.toArray()).map((o) => o.key)), [], new Set<string>());
  const conflictKeys = useLiveQuery(async () => new Set((await db.conflicts.toArray()).map((o) => o.key)), [], new Set<string>());
  const trash = useLiveQuery(() => repo.listTrash('transactions'), [], []);
  const history = useLiveQuery(() => db.history.orderBy('ts').reverse().limit(200).toArray(), [], []);
  const accName = (id: string | null) => L.accounts.find((a) => a.id === id)?.name ?? '—';
  const catName = (id: string | null) => L.categories.find((c) => c.id === id)?.name ?? '';

  const rows = useMemo(() => L.transactions.filter((t) =>
    (!month || monthOf(t.date) === month) && (!type || t.type === type) && (!acc || t.accountId === acc || t.toAccountId === acc) && (!cat || t.categoryId === cat) &&
    (!q || `${t.description} ${t.counterparty} ${t.note} ${t.tags.join(' ')} ${t.bankRef}`.toLowerCase().includes(q.toLowerCase()))
  ).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt), [L.transactions, month, type, acc, cat, q]);

  const syncBadge = (t: Transaction) => {
    if (t.isSample) return <span className="badge sample">Mẫu · không đồng bộ</span>;
    if (!sync.configured || !sync.email) return <span className="badge">Chỉ trên máy này</span>;
    if (conflictKeys.has(`transactions:${t.id}`)) return <span className="badge bad">Xung đột</span>;
    if (pendingKeys.has(`transactions:${t.id}`)) return <span className="badge warn">Chờ đồng bộ</span>;
    return <span className="badge good">Đã đồng bộ</span>;
  };

  return <>
    <div className="topbar"><h1 className="grow">Giao dịch</h1><button className="btn primary" onClick={() => setEditing('new')}>+ Thêm giao dịch</button></div>
    <div className="tabs" role="tablist">
      {([['list', `Giao dịch (${rows.length})`], ['trash', `Thùng rác (${trash.length})`], ['history', 'Lịch sử thao tác']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
    </div>

    {tab === 'list' && <>
      <div className="card" style={{ marginBottom: 12 }}><div className="row">
        <div className="grow"><input placeholder="Tìm nội dung, ghi chú, thẻ…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm kiếm" /></div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 150 }} aria-label="Lọc theo tháng" />
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 140 }} aria-label="Lọc theo loại"><option value="">Mọi loại</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={acc} onChange={(e) => setAcc(e.target.value)} style={{ width: 160 }} aria-label="Lọc theo tài khoản"><option value="">Mọi tài khoản</option>{L.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 170 }} aria-label="Lọc theo danh mục"><option value="">Mọi danh mục</option>{L.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div></div>
      {rows.length === 0 ? <div className="card"><Empty title={L.transactions.length ? 'Không có giao dịch khớp bộ lọc' : 'Chưa có giao dịch'}>{!L.transactions.length && <button className="btn primary" onClick={() => setEditing('new')}>Thêm giao dịch đầu tiên</button>}</Empty></div> :
        <div className="card table-wrap"><table><thead><tr><th>Ngày</th><th>Loại</th><th>Nội dung</th><th>Danh mục</th><th>Tài khoản</th><th className="right">Số tiền</th><th>Đồng bộ</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
          <tbody>{rows.map((t) => <tr key={t.id}>
            <td className="nowrap">{formatDateVi(t.date)}</td><td>{TYPE_LABEL[t.type]}{t.refund ? ' (hoàn)' : ''}</td>
            <td>{t.description || <span className="muted">—</span>}{t.counterparty && <div className="small muted">{t.counterparty}</div>}{t.tags.length > 0 && <div className="small">{t.tags.map((x) => <span key={x} className="badge">{x}</span>)}</div>}</td>
            <td>{catName(t.categoryId)}</td><td>{accName(t.accountId)}{t.toAccountId ? ` → ${accName(t.toAccountId)}` : ''}</td>
            <td className="right"><Money v={t.type === 'income' || t.refund ? t.amount : t.type === 'expense' ? -t.amount : t.type === 'adjustment' ? t.amount : t.amount} signed={t.type !== 'transfer'} /></td>
            <td>{syncBadge(t)}</td>
            <td className="nowrap"><button className="btn small" onClick={() => setEditing(t)}>Sửa</button> <button className="btn small danger" onClick={() => setDelTarget(t)}>Xóa</button></td>
          </tr>)}</tbody></table></div>}
    </>}

    {tab === 'trash' && (trash.length === 0 ? <div className="card"><Empty title="Thùng rác trống" /></div> :
      <div className="card table-wrap"><Banner kind="info">Giao dịch trong thùng rác không được tính vào số dư/báo cáo. Xóa vĩnh viễn không thể hoàn tác.</Banner>
        <table><thead><tr><th>Ngày</th><th>Nội dung</th><th className="right">Số tiền</th><th>Đã xóa lúc</th><th /></tr></thead><tbody>{trash.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)).map((t) => <tr key={t.id}>
          <td>{formatDateVi(t.date)}</td><td>{t.description || TYPE_LABEL[t.type]}</td><td className="right"><Money v={t.amount} /></td><td className="small">{new Date(t.deletedAt!).toLocaleString('vi-VN')}</td>
          <td className="nowrap"><button className="btn small" onClick={() => void run(() => repo.restore('transactions', t.id), 'Đã khôi phục')}>Khôi phục</button> <button className="btn small danger" onClick={() => setPurgeTarget(t)}>Xóa vĩnh viễn</button></td></tr>)}</tbody></table></div>)}

    {tab === 'history' && (history.length === 0 ? <div className="card"><Empty title="Chưa có lịch sử" /></div> :
      <div className="card table-wrap"><p className="small muted">Lịch sử chỉ đọc — không thể chỉnh sửa. Hiển thị 200 thao tác gần nhất.</p>
        <table><thead><tr><th>Thời điểm</th><th>Thao tác</th><th>Chi tiết</th></tr></thead><tbody>{history.map((h) => <tr key={h.id}>
          <td className="nowrap small">{new Date(h.ts).toLocaleString('vi-VN')}</td><td>{h.summary || h.action}{h.isSample && <span className="badge sample">Mẫu</span>}</td>
          <td className="small">{h.changes.filter((c) => !['id', 'deletedAt', 'purged', 'isSample', 'recordedAt'].includes(c.field)).slice(0, 4).map((c) => `${c.field}: ${c.before === undefined ? '∅' : JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`).join('; ')}</td></tr>)}</tbody></table></div>)}

    {editing && <TxForm L={L} tx={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    {delTarget && <Confirm title="Chuyển vào thùng rác?" confirmLabel="Chuyển vào thùng rác" danger onCancel={() => setDelTarget(null)} onConfirm={() => { void run(() => repo.softDelete('transactions', delTarget.id), 'Đã chuyển vào thùng rác'); setDelTarget(null); }}>
      <p>{formatDateVi(delTarget.date)} · {delTarget.description || TYPE_LABEL[delTarget.type]} · <Money v={delTarget.amount} /></p><p className="small muted">Bạn có thể khôi phục từ thùng rác.</p></Confirm>}
    {purgeTarget && <Confirm title="Xóa vĩnh viễn?" confirmLabel="Xóa vĩnh viễn" danger onCancel={() => setPurgeTarget(null)} onConfirm={() => { void run(() => repo.purge('transactions', purgeTarget.id), 'Đã xóa vĩnh viễn'); setPurgeTarget(null); }}>
      <p>Giao dịch này sẽ bị xóa hẳn khỏi thiết bị này và các thiết bị đồng bộ. <strong>Không thể hoàn tác.</strong></p></Confirm>}
  </>;
}

function TxForm({ L, tx, onClose }: { L: Ledger; tx: Transaction | null; onClose: () => void }) {
  const [type, setType] = useState<TxType>(tx?.type ?? 'expense');
  const [amount, setAmount] = useState<number | null>(tx ? Math.abs(tx.amount) : null);
  const [adjSign, setAdjSign] = useState<1 | -1>(tx && tx.type === 'adjustment' && tx.amount < 0 ? -1 : 1);
  const [date, setDate] = useState(tx?.date ?? L.today);
  const [accountId, setAccountId] = useState(tx?.accountId ?? L.accounts[0]?.id ?? '');
  const [toAccountId, setTo] = useState(tx?.toAccountId ?? '');
  const [categoryId, setCat] = useState(tx?.categoryId ?? '');
  const [description, setDesc] = useState(tx?.description ?? '');
  const [counterparty, setCp] = useState(tx?.counterparty ?? '');
  const [note, setNote] = useState(tx?.note ?? '');
  const [tags, setTags] = useState(tx?.tags.join(', ') ?? '');
  const [refund, setRefund] = useState(tx?.refund ?? false);
  const [err, setErr] = useState('');
  const { run, busy } = useAction();
  const cats = L.categories.filter((c) => c.kind === (type === 'income' ? 'income' : 'expense') && (!c.archived || c.id === tx?.categoryId));
  const catValue = cats.some((c) => c.id === categoryId) ? categoryId : '';

  const save = async () => {
    setErr('');
    if (amount === null || amount === 0) return setErr('Hãy nhập số tiền hợp lệ');
    const body = {
      type, amount: type === 'adjustment' ? adjSign * amount : amount, date, accountId, toAccountId: type === 'transfer' ? toAccountId || null : null,
      categoryId: type === 'income' || type === 'expense' ? catValue || null : null, description, counterparty, note, refund: type === 'expense' && refund,
      tags: tags.split(',').map((x) => x.trim()).filter(Boolean),
    };
    try {
      if (tx) await repo.update('transactions', tx.id, body as never); else await repo.create('transactions', body as never);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Không lưu được'); }
  };
  return <Modal title={tx ? 'Sửa giao dịch' : 'Thêm giao dịch'} onClose={onClose}>
    <form onSubmit={(e) => { e.preventDefault(); void run(save); }}>
      {tx?.isSample && <Banner kind="sample">Đây là giao dịch mẫu.</Banner>}
      <div className="row" role="radiogroup" aria-label="Loại giao dịch" style={{ marginBottom: 10 }}>
        {(Object.keys(TYPE_LABEL) as TxType[]).map((k) => <button type="button" key={k} role="radio" aria-checked={type === k} className={`btn small ${type === k ? 'primary' : ''}`} onClick={() => setType(k)}>{TYPE_LABEL[k]}</button>)}
      </div>
      <div className="grid g2">
        <Field label="Số tiền (VND)"><MoneyInput value={amount} onChange={setAmount} required /></Field>
        <Field label="Ngày giao dịch"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label={type === 'transfer' ? 'Từ tài khoản' : 'Tài khoản'}><select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{L.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        {type === 'transfer' && <Field label="Đến tài khoản"><select value={toAccountId} onChange={(e) => setTo(e.target.value)}><option value="">— chọn —</option>{L.accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
        {(type === 'income' || type === 'expense') && <Field label="Danh mục"><select value={catValue} onChange={(e) => setCat(e.target.value)}><option value="">— chọn —</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        {type === 'adjustment' && <Field label="Chiều điều chỉnh"><select value={adjSign} onChange={(e) => setAdjSign(Number(e.target.value) as 1 | -1)}><option value={1}>Tăng số dư (+)</option><option value={-1}>Giảm số dư (−)</option></select></Field>}
      </div>
      {type === 'expense' && <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} /> Đây là khoản hoàn tiền (giảm chi phí, tăng số dư)</label>}
      {type === 'income' && <p className="small muted">Chỉ ghi thu nhập khi bạn thực sự nhận tiền. Không tự lấy doanh thu Gốm Kể làm thu nhập cá nhân.</p>}
      {type === 'transfer' && <p className="small muted">Chuyển tiền giữa tài khoản của bạn không phải thu nhập hay chi phí.</p>}
      {type === 'adjustment' && <p className="small muted">Dùng để khớp số dư với thực tế. Không tính vào thu/chi.</p>}
      <Field label="Nội dung"><input value={description} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></Field>
      <div className="grid g2"><Field label="Người nhận / nguồn thu"><input value={counterparty} onChange={(e) => setCp(e.target.value)} maxLength={120} /></Field><Field label="Thẻ (phân cách bằng dấu phẩy)"><input value={tags} onChange={(e) => setTags(e.target.value)} /></Field></div>
      <Field label="Ghi chú"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      {err && <p className="neg" role="alert">{err}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Hủy</button><button className="btn primary" type="submit" disabled={busy}>Lưu</button></div>
    </form>
  </Modal>;
}
