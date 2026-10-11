import { useMemo, useState } from 'react';
import * as repo from '../../db/repo';
import type { Ledger } from '../hooks';
import { ACCOUNT_TYPES, ASSET_TYPES, type Account, type Asset } from '../../domain/schemas';
import { accountBalances, netWorth } from '../../domain/calc';
import { Banner, Confirm, Empty, Field, Modal, Money, MoneyInput, Stat, useAction } from '../components/common';
import { formatVnd } from '../../domain/money';

const ASSET_LABEL: Record<string, string> = { cash: 'Tiền mặt', bank: 'Tài khoản ngân hàng', savings: 'Tiền tiết kiệm', gold: 'Vàng', vehicle: 'Xe', property: 'Bất động sản', investment: 'Khoản đầu tư', other: 'Tài sản khác' };
const ACC_LABEL: Record<string, string> = { cash: 'Tiền mặt', bank: 'Ngân hàng', ewallet: 'Ví điện tử', savings: 'Tiết kiệm' };
const DEFAULT_LIQ: Record<string, Asset['liquidity']> = { cash: 'liquid', bank: 'liquid', savings: 'liquid', gold: 'semi', investment: 'semi', vehicle: 'illiquid', property: 'illiquid', other: 'illiquid' };
const LIQ_LABEL = { liquid: 'Thanh khoản cao', semi: 'Bán được nhưng mất thời gian/giá biến động', illiquid: 'Khó chuyển thành tiền' };

export function Assets({ L }: { L: Ledger }) {
  const [assetEdit, setAssetEdit] = useState<Asset | 'new' | null>(null);
  const [accEdit, setAccEdit] = useState<Account | 'new' | null>(null);
  const [del, setDel] = useState<Asset | null>(null);
  const { run } = useAction();
  const bal = useMemo(() => accountBalances(L.accounts, L.transactions, L.today), [L]);
  const nw = useMemo(() => netWorth(L.accounts, L.transactions, L.assets, L.settings, L.today), [L]);
  return <>
    <div className="topbar"><h1 className="grow">Tài sản</h1><button className="btn" onClick={() => setAccEdit('new')}>+ Tài khoản tiền</button><button className="btn primary" onClick={() => setAssetEdit('new')}>+ Tài sản</button></div>
    <div className="grid g4">
      <Stat label="Tiền trong tài khoản (sổ giao dịch)" value={formatVnd(nw.ledgerMoney)} sub="Tự tính từ giao dịch" />
      <Stat label="Tài sản thanh khoản khác" value={formatVnd(nw.manualLiquid + nw.semiLiquid)} sub={`Gồm bán được ${formatVnd(nw.semiLiquid)}`} />
      <Stat label="Tài sản khó chuyển thành tiền" value={formatVnd(nw.illiquid)} sub="Xe, nhà… không dùng để chi tiêu" />
      <Stat label="Tài sản ròng" value={formatVnd(nw.netWorth)} tone={nw.netWorth >= 0 ? 'pos' : 'neg'} sub={nw.liabilitiesDeclared ? `Đã trừ nghĩa vụ ${formatVnd(nw.liabilities)}` : 'Chưa trừ nghĩa vụ nào'} />
    </div>
    {!nw.liabilitiesDeclared && <Banner kind="warn">Giá trị ròng <strong>chưa phản ánh các khoản nợ/nghĩa vụ chưa khai báo</strong>. Phiên bản này không quản lý nợ; nếu có, hãy nhập tổng nghĩa vụ trong Cài đặt. Ứng dụng không mặc định rằng bạn không có nợ.</Banner>}
    <Banner kind="info">Tiền có thể dùng chi tiêu ngay: <strong>{formatVnd(nw.spendable)}</strong> (chỉ gồm tiền trong tài khoản và tài sản thanh khoản cao). Doanh thu, tiền mặt và tài sản của Gốm Kể <strong>không</strong> tự động nằm ở đây.</Banner>

    <section className="card" style={{ marginBottom: 12 }}><h2>Tài khoản tiền (theo sổ giao dịch)</h2>
      <div className="table-wrap"><table><thead><tr><th>Tên</th><th>Loại</th><th className="right">Số dư hiện tại</th><th className="right">Số dư đầu</th><th /></tr></thead><tbody>
        {L.accounts.map((a) => <tr key={a.id}><td>{a.name}{a.isSample && <span className="badge sample">Mẫu</span>}{a.archived && <span className="badge">Đã lưu trữ</span>}</td><td>{ACC_LABEL[a.type]}</td><td className="right"><Money v={bal.get(a.id) ?? 0} /></td><td className="right small">{formatVnd(a.openingBalance)} <span className="muted">({a.openingDate})</span></td><td><button className="btn small" onClick={() => setAccEdit(a)}>Sửa</button></td></tr>)}</tbody></table></div>
    </section>

    <section className="card"><h2>Tài sản khác (nhập tay)</h2>
      <p className="small muted">Dùng cho vàng, xe, nhà, đầu tư, và tiền gửi ngoài sổ. Đừng nhập lại tài khoản đã có ở trên để tránh tính hai lần.</p>
      {L.assets.length === 0 ? <Empty title="Chưa có tài sản nhập tay" /> : <div className="table-wrap"><table><thead><tr><th>Tên</th><th>Loại</th><th>Thanh khoản</th><th>Định giá</th><th className="right">Giá trị hiện tại</th><th className="right">Giá mua</th><th /></tr></thead><tbody>
        {L.assets.map((a) => <tr key={a.id}><td>{a.name}{a.isSample && <span className="badge sample">Mẫu</span>}{a.note && <div className="small muted">{a.note}</div>}</td><td>{ASSET_LABEL[a.type]}</td><td className="small">{LIQ_LABEL[a.liquidity]}</td><td>{a.valuationDate}</td><td className="right"><Money v={a.currentValue} /></td><td className="right">{a.purchaseValue !== null ? <Money v={a.purchaseValue} /> : '—'}</td>
          <td className="nowrap"><button className="btn small" onClick={() => setAssetEdit(a)}>Sửa</button> <button className="btn small danger" onClick={() => setDel(a)}>Xóa</button></td></tr>)}</tbody></table></div>}
    </section>
    {assetEdit && <AssetForm L={L} asset={assetEdit === 'new' ? null : assetEdit} onClose={() => setAssetEdit(null)} />}
    {accEdit && <AccountForm acc={accEdit === 'new' ? null : accEdit} L={L} onClose={() => setAccEdit(null)} />}
    {del && <Confirm title="Xóa tài sản?" danger confirmLabel="Xóa" onCancel={() => setDel(null)} onConfirm={() => { void run(() => repo.softDelete('assets', del.id), 'Đã xóa'); setDel(null); }}><p>“{del.name}” sẽ không còn được tính vào tài sản.</p></Confirm>}
  </>;
}

function AssetForm({ L, asset, onClose }: { L: Ledger; asset: Asset | null; onClose: () => void }) {
  const [name, setName] = useState(asset?.name ?? ''); const [type, setType] = useState<Asset['type']>(asset?.type ?? 'gold'); const [liq, setLiq] = useState<Asset['liquidity']>(asset?.liquidity ?? 'semi');
  const [date, setDate] = useState(asset?.valuationDate ?? L.today); const [val, setVal] = useState<number | null>(asset?.currentValue ?? null); const [buy, setBuy] = useState<number | null>(asset?.purchaseValue ?? null); const [note, setNote] = useState(asset?.note ?? '');
  const [err, setErr] = useState(''); const { run, busy } = useAction();
  const save = async () => { try { if (val === null) return setErr('Nhập giá trị hiện tại'); const b = { name, type, liquidity: liq, valuationDate: date, currentValue: val, purchaseValue: buy, note }; if (asset) await repo.update('assets', asset.id, b); else await repo.create('assets', b as never); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Lỗi'); } };
  return <Modal title={asset ? 'Sửa tài sản' : 'Thêm tài sản'} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); void run(save); }}>
    <Field label="Tên"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
    <div className="grid g2"><Field label="Loại"><select value={type} onChange={(e) => { setType(e.target.value as Asset['type']); setLiq(DEFAULT_LIQ[e.target.value]!); }}>{ASSET_TYPES.map((t) => <option key={t} value={t}>{ASSET_LABEL[t]}</option>)}</select></Field>
      <Field label="Thanh khoản"><select value={liq} onChange={(e) => setLiq(e.target.value as Asset['liquidity'])}>{Object.entries(LIQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Giá trị hiện tại (VND)"><MoneyInput value={val} onChange={setVal} required /></Field><Field label="Ngày định giá"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
      <Field label="Giá mua (nếu biết)"><MoneyInput value={buy} onChange={setBuy} /></Field></div>
    <Field label="Ghi chú"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    {err && <p className="neg" role="alert">{err}</p>}<div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Hủy</button><button className="btn primary" disabled={busy}>Lưu</button></div></form></Modal>;
}

function AccountForm({ acc, L, onClose }: { acc: Account | null; L: Ledger; onClose: () => void }) {
  const [name, setName] = useState(acc?.name ?? ''); const [type, setType] = useState<Account['type']>(acc?.type ?? 'bank'); const [open, setOpen] = useState<number | null>(acc?.openingBalance ?? 0);
  const [date, setDate] = useState(acc?.openingDate ?? L.today); const [last4, setLast4] = useState(acc?.last4 ?? ''); const [arch, setArch] = useState(acc?.archived ?? false);
  const [err, setErr] = useState(''); const { run, busy } = useAction();
  const save = async () => { try { const b = { name, type, openingBalance: open ?? 0, openingDate: date, last4: last4.replace(/\D/g, '').slice(-4), archived: arch }; if (acc) await repo.update('accounts', acc.id, b); else await repo.create('accounts', { ...b, order: L.accounts.length } as never); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Lỗi'); } };
  return <Modal title={acc ? 'Sửa tài khoản' : 'Thêm tài khoản'} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); void run(save); }}>
    <Field label="Tên"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
    <div className="grid g2"><Field label="Loại"><select value={type} onChange={(e) => setType(e.target.value as Account['type'])}>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACC_LABEL[t]}</option>)}</select></Field>
      <Field label="4 số cuối (không bắt buộc)" hint="Không lưu số tài khoản đầy đủ"><input value={last4} onChange={(e) => setLast4(e.target.value)} maxLength={4} inputMode="numeric" /></Field>
      <Field label="Số dư đầu (VND)" hint="Số tiền có trong tài khoản đầu ngày bên dưới"><MoneyInput value={open} onChange={setOpen} allowNegative /></Field><Field label="Ngày của số dư đầu"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field></div>
    {acc && <label className="row"><input type="checkbox" checked={arch} onChange={(e) => setArch(e.target.checked)} /> Lưu trữ (ẩn khỏi danh sách chọn, vẫn tính số dư)</label>}
    {err && <p className="neg" role="alert">{err}</p>}<div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Hủy</button><button className="btn primary" disabled={busy}>Lưu</button></div></form></Modal>;
}
