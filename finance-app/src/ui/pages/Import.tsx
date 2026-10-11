import { useMemo, useRef, useState } from 'react';
import * as repo from '../../db/repo';
import type { Ledger } from '../hooks';
import { commitImport, detectMapping, ImportError, normalizeRows, readFile, type ColumnMapping, type ImportRow, type ParsedTable } from '../../io/importer';
import { Banner, Confirm, Empty, Field, Money, useAction, useToast } from '../components/common';
import { formatDateVi } from '../../domain/dates';
import { formatVnd } from '../../domain/money';

type Step = 'pick' | 'map' | 'preview' | 'done';
const ROLES: Array<[keyof Pick<ColumnMapping, 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance' | 'ref'>, string]> = [
  ['date', 'Ngày'], ['description', 'Nội dung'], ['amount', 'Số tiền (một cột, có dấu)'], ['debit', 'Ghi nợ / tiền ra'], ['credit', 'Ghi có / tiền vào'], ['balance', 'Số dư (nếu có)'], ['ref', 'Mã giao dịch'],
];

export function ImportPage({ L }: { L: Ledger }) {
  const [step, setStep] = useState<Step>('pick');
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [map, setMap] = useState<ColumnMapping | null>(null);
  const [confident, setConfident] = useState(false);
  const [accountId, setAccountId] = useState(L.accounts.find((a) => a.type === 'bank')?.id ?? L.accounts[0]?.id ?? '');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();
  const toast = useToast();

  const reset = () => { setStep('pick'); setTable(null); setMap(null); setRows([]); setError(''); setResult(null); if (fileRef.current) fileRef.current.value = ''; };

  const onFile = async (f: File | undefined) => {
    setError('');
    if (!f) return;
    try {
      const t = await readFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      const d = detectMapping(t.rows);
      setTable(t); setMap(d.mapping); setConfident(d.confident); setStep('map');
      if (t.fileHash && L.importBatches.some((b) => b.fileHash === t.fileHash)) toast('info', 'Tệp này giống hệt một tệp đã nhập trước đó — hãy cẩn thận trùng lặp.');
    } catch (e) { setError(e instanceof ImportError || e instanceof Error ? e.message : 'Không đọc được tệp'); }
  };

  const toPreview = () => {
    if (!table || !map) return;
    if (map.date === null || (map.amount === null && map.debit === null && map.credit === null)) return setError('Cần chọn ít nhất cột Ngày và cột Số tiền (hoặc Ghi nợ/Ghi có).');
    setError('');
    const n = normalizeRows(table, map, { accountId, existing: L.allTransactions, categories: L.categories });
    setRows(n.rows); setSkipped(n.skipped.length); setStep('preview');
  };

  const patch = (i: number, p: Partial<ImportRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const chosen = rows.filter((r) => r.include);
  const stats = useMemo(() => ({ err: rows.filter((r) => r.errors.length).length, dup: rows.filter((r) => r.duplicates.length).length, inc: chosen.filter((r) => r.type === 'income').reduce((s, r) => s + (r.amount ?? 0), 0), exp: chosen.filter((r) => r.type === 'expense').reduce((s, r) => s + (r.amount ?? 0), 0) }), [rows, chosen]);
  const catsFor = (t: 'income' | 'expense') => L.categories.filter((c) => c.kind === t);

  const doCommit = () => run(async () => {
    const r = await commitImport({ rows, table: table!, accountId, skippedCount: skipped, categories: L.categories });
    setResult({ count: r.count }); setStep('done');
  }, 'Đã nhập vào sổ');

  return <>
    <div className="topbar"><h1 className="grow">Nhập sao kê</h1>{step !== 'pick' && step !== 'done' && <button className="btn" onClick={reset}>Hủy nhập</button>}</div>
    <ol className="row small muted" style={{ listStyle: 'none', padding: 0 }} aria-label="Các bước">
      {(['pick', 'map', 'preview', 'done'] as Step[]).map((s, i) => <li key={s} aria-current={step === s ? 'step' : undefined} style={{ fontWeight: step === s ? 700 : 400, color: step === s ? 'var(--brand-dark)' : undefined }}>{i + 1}. {{ pick: 'Chọn tệp', map: 'Ánh xạ cột', preview: 'Xem trước & xác nhận', done: 'Hoàn tất' }[s]}{i < 3 ? ' ›' : ''}</li>)}
    </ol>
    {error && <Banner kind="error">{error}</Banner>}

    {step === 'pick' && <div className="card">
      <Field label="Tài khoản nhận các giao dịch này"><select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{L.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Tệp sao kê (.csv, .xlsx hoặc .pdf có lớp văn bản — tối đa 10 MB)"><input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.pdf" onChange={(e) => void onFile(e.target.files?.[0])} /></Field>
      <ul className="small muted"><li>Chưa ghi gì vào sổ cho đến khi bạn bấm xác nhận ở bước cuối.</li><li>PDF bản quét (ảnh) cần OCR — chưa hỗ trợ. PDF đọc theo cách đoán chung, không đảm bảo đúng với mọi ngân hàng.</li><li>Không tìm thấy định dạng phù hợp? Hãy nhập tay ở mục Giao dịch.</li></ul>
      {L.importBatches.length > 0 && <><h2>Lịch sử các lô đã nhập</h2><div className="table-wrap"><table><thead><tr><th>Tệp</th><th>Lúc</th><th className="right">Số dòng</th><th>Ghi chú</th><th /></tr></thead><tbody>
        {L.importBatches.sort((a, b) => b.createdAt - a.createdAt).map((b) => <tr key={b.id}><td>{b.fileName} <span className="badge">{b.kind}</span></td><td className="small">{new Date(b.createdAt).toLocaleString('vi-VN')}</td><td className="right">{b.rowCount}</td><td className="small">{b.log.join(' · ')}</td><td><button className="btn small danger" onClick={() => setUndoId(b.id)}>Hoàn tác lô</button></td></tr>)}</tbody></table></div></>}
    </div>}

    {step === 'map' && table && map && <div className="card">
      <p>Tệp: <strong>{table.fileName}</strong> ({table.rows.length} dòng) {confident ? <span className="badge good">Đã nhận diện cột</span> : <span className="badge warn">Chưa chắc chắn — hãy kiểm tra ánh xạ</span>}</p>
      {table.warnings.map((w) => <Banner key={w} kind="warn">{w}</Banner>)}
      <div className="grid g3">
        <Field label="Dòng tiêu đề"><select value={map.headerRow} onChange={(e) => setMap({ ...map, headerRow: Number(e.target.value) })}><option value={-1}>Không có tiêu đề</option>{table.rows.slice(0, 15).map((_, i) => <option key={i} value={i}>Dòng {i + 1}</option>)}</select></Field>
        {ROLES.map(([k, label]) => <Field key={k} label={label}><select value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">— không dùng —</option>{(table.rows[Math.max(0, map.headerRow)] ?? []).map((h, i) => <option key={i} value={i}>Cột {i + 1}: {String(h ?? '').slice(0, 24)}</option>)}</select></Field>)}
      </div>
      <div className="row">
        {map.amount !== null && <label className="row"><input type="checkbox" checked={map.invertSign} onChange={(e) => setMap({ ...map, invertSign: e.target.checked })} /> Đảo dấu (số dương là chi)</label>}
        {(map.debit !== null || map.credit !== null) && <label className="row"><input type="checkbox" checked={map.swapDebitCredit} onChange={(e) => setMap({ ...map, swapDebitCredit: e.target.checked })} /> Đảo nợ/có (mặc định: Ghi nợ = tiền ra, Ghi có = tiền vào)</label>}
        {map.debit === null && map.credit === null && <label className="row">Số tiền không có dấu coi là <select style={{ width: 90 }} value={map.unsignedAs} onChange={(e) => setMap({ ...map, unsignedAs: e.target.value as 'expense' | 'income' })}><option value="expense">chi</option><option value="income">thu</option></select></label>}
      </div>
      <h3>Dữ liệu thô (10 dòng đầu)</h3>
      <div className="table-wrap"><table><tbody>{table.rows.slice(0, 10).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="small">{c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '')}</td>)}</tr>)}</tbody></table></div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" onClick={reset}>Chọn tệp khác</button><button className="btn primary" onClick={toPreview}>Xem trước</button></div>
    </div>}

    {step === 'preview' && <div className="card">
      <div className="grid g4" style={{ marginBottom: 10 }}>
        <div><div className="small muted">Dòng đọc được</div><strong>{rows.length}</strong> <span className="small muted">(bỏ qua {skipped} dòng không phải giao dịch)</span></div>
        <div><div className="small muted">Sẽ nhập</div><strong>{chosen.length}</strong></div>
        <div><div className="small muted">Lỗi / nghi trùng</div><strong className={stats.err ? 'neg' : ''}>{stats.err}</strong> / <strong>{stats.dup}</strong></div>
        <div><div className="small muted">Thu / Chi sẽ nhập</div><span className="pos num">{formatVnd(stats.inc)}</span> / <span className="neg num">{formatVnd(stats.exp)}</span></div>
      </div>
      {table?.warnings.map((w) => <Banner key={w} kind="warn">{w}</Banner>)}
      {rows.length === 0 ? <Empty title="Không tìm thấy giao dịch nào">Hãy quay lại chỉnh ánh xạ cột.</Empty> : <div className="table-wrap"><table><thead><tr><th>Nhập</th><th>Dòng</th><th>Ngày</th><th>Nội dung</th><th>Loại</th><th className="right">Số tiền</th><th>Danh mục</th><th>Ghi chú</th></tr></thead><tbody>
        {rows.map((r, i) => <tr key={i} style={r.errors.length ? { background: '#fdecea' } : r.duplicates.length ? { background: '#fff6e0' } : undefined}>
          <td><input type="checkbox" checked={r.include} disabled={r.errors.length > 0} onChange={(e) => patch(i, { include: e.target.checked })} aria-label={`Nhập dòng ${r.index}`} /></td>
          <td>{r.index}</td><td className="nowrap">{r.date ? formatDateVi(r.date) : '—'}</td>
          <td style={{ minWidth: 200 }}><input value={r.description} onChange={(e) => patch(i, { description: e.target.value })} aria-label={`Nội dung dòng ${r.index}`} /></td>
          <td><select value={r.type} onChange={(e) => patch(i, { type: e.target.value as 'income' | 'expense', categoryId: null })} style={{ width: 90 }}><option value="expense">Chi</option><option value="income">Thu</option></select></td>
          <td className="right">{r.amount !== null ? <Money v={r.amount} /> : '—'}</td>
          <td><select value={r.categoryId ?? ''} onChange={(e) => patch(i, { categoryId: e.target.value || null })} style={{ width: 160 }}><option value="">(Khoản chi/thu khác)</option>{catsFor(r.type).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{r.categoryReason && <div className="small muted">{r.categoryReason}</div>}</td>
          <td className="small">{r.errors.map((e) => <div key={e} className="neg">⚠ {e}</div>)}{r.warnings.map((w) => <div key={w} className="muted">{w}</div>)}{r.duplicates.slice(0, 1).map((d) => <div key={d.existingId}><span className={`badge ${d.level === 'strong' ? 'bad' : 'warn'}`}>{d.level === 'strong' ? 'Rất có thể trùng' : 'Có thể trùng'}</span> {d.reasons.join('; ')}</div>)}</td></tr>)}</tbody></table></div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={() => setStep('map')}>← Sửa ánh xạ</button><button className="btn primary" disabled={chosen.length === 0 || busy} onClick={() => setConfirm(true)}>Nhập {chosen.length} giao dịch…</button></div>
    </div>}

    {step === 'done' && result && <div className="card"><Banner kind="success">Đã ghi <strong>{result.count}</strong> giao dịch vào sổ. Có thể xem lại hoặc hoàn tác cả lô ở danh sách các lô đã nhập.</Banner><div className="row"><button className="btn primary" onClick={reset}>Nhập tệp khác</button><a className="btn" href="#/giao-dich">Xem giao dịch</a></div></div>}

    {confirm && <Confirm title="Xác nhận ghi vào sổ chính thức" confirmLabel={`Ghi ${chosen.length} giao dịch`} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void doCommit(); }}>
      <p>Tài khoản: <strong>{L.accounts.find((a) => a.id === accountId)?.name}</strong></p><p>Thu: <Money v={stats.inc} /> · Chi: <Money v={stats.exp} /></p>
      {chosen.some((r) => r.duplicates.length) && <p className="neg">Có {chosen.filter((r) => r.duplicates.length).length} dòng nghi trùng mà bạn đã chọn vẫn nhập.</p>}
      <p className="small muted">Bạn có thể hoàn tác cả lô sau đó (chuyển vào thùng rác).</p></Confirm>}
    {undoId && <Confirm title="Hoàn tác lô nhập?" confirmLabel="Chuyển cả lô vào thùng rác" danger onCancel={() => setUndoId(null)} onConfirm={() => { void run(async () => { const n = await repo.undoImportBatch(undoId); return n; }, 'Đã chuyển lô vào thùng rác'); setUndoId(null); }}><p>Toàn bộ giao dịch của lô này sẽ vào thùng rác (khôi phục được).</p></Confirm>}
  </>;
}
